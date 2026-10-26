import { Buffer } from "node:buffer";
import { Inject, Injectable, NgModule } from "@angular/core";
import { NotificationsService } from "tabby-core";
import {
  BaseSession,
  BaseTerminalTabComponent,
  SessionMiddleware,
  TerminalDecorator,
  XTermFrontend,
} from "tabby-terminal";
import { TabbyProtocolReceiver } from "./receiver.ts";
import { StreamingOrdinaryWriter } from "./ordinary-writer.ts";

class TuiProtocolSessionMiddleware extends SessionMiddleware {
  readonly #receiver: TabbyProtocolReceiver;

  constructor(
    terminal: XTermFrontend["xterm"],
    writeText: (text: string) => Promise<void>,
    onFailure: (error: Error) => void,
  ) {
    super();
    const ordinary = new StreamingOrdinaryWriter({
      write: writeText,
      settle: () => new Promise<void>(resolve => terminal.write("", resolve)),
    });
    this.#receiver = new TabbyProtocolReceiver({
      terminal,
      writeOrdinary: data => ordinary.write(data),
      finishOrdinary: () => ordinary.finish(),
      onResponseFrame: frame => this.outputToSession.next(Buffer.from(frame)),
      onDiagnostic: diagnostic => console.error("tui-protocol:", diagnostic.reason),
      onFailure,
    });
  }

  override feedFromSession(data: Buffer): void {
    this.#receiver.feed(data);
  }

  override close(): void {
    void this.#receiver.finish().then(
      () => this.#receiver.dispose(),
      () => this.#receiver.dispose(),
    );
    super.close();
  }
}

interface AttachedSession {
  readonly session: BaseSession;
  readonly middleware: TuiProtocolSessionMiddleware;
  readonly restorePassthrough: boolean;
}

@Injectable()
class TuiProtocolDecorator extends TerminalDecorator {
  readonly #attached = new Map<BaseTerminalTabComponent<any>, AttachedSession>();

  constructor(@Inject(NotificationsService) private notifications: NotificationsService) {
    super();
  }

  override attach(terminal: BaseTerminalTabComponent<any>): void {
    const attachSession = (session: BaseSession | null) => {
      this.#detachSession(terminal);
      if (session === null || !(terminal.frontend instanceof XTermFrontend)) return;
      const middleware = new TuiProtocolSessionMiddleware(
        terminal.frontend.xterm,
        text => terminal.write(text),
        error => {
          console.error("tui-protocol receiver failed:", error);
          this.notifications.error("TUI protocol stopped. Close this tab before retrying.");
        },
      );
      const restorePassthrough = terminal.enablePassthrough;
      terminal.enablePassthrough = false;
      session.middleware.unshift(middleware);
      this.#attached.set(terminal, { session, middleware, restorePassthrough });
    };
    this.subscribeUntilDetached(terminal, terminal.sessionChanged$.subscribe(attachSession));
    attachSession(terminal.session);
  }

  override detach(terminal: BaseTerminalTabComponent<any>): void {
    this.#detachSession(terminal);
    super.detach(terminal);
  }

  #detachSession(terminal: BaseTerminalTabComponent<any>): void {
    const attached = this.#attached.get(terminal);
    if (attached === undefined) return;
    this.#attached.delete(terminal);
    attached.session.middleware.remove(attached.middleware);
    terminal.enablePassthrough = attached.restorePassthrough;
    attached.middleware.close();
  }
}

@NgModule({
  providers: [
    { provide: TerminalDecorator, useClass: TuiProtocolDecorator, multi: true },
  ],
})
export default class TuiProtocolModule {}
