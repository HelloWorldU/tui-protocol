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
import { readTabbyXtermDependency, TabbyXtermCompatibilityGate } from "./compatibility.ts";

class TuiProtocolSessionMiddleware extends SessionMiddleware {
  readonly #receiver: TabbyProtocolReceiver;

  constructor(receiver: TabbyProtocolReceiver) {
    super();
    this.#receiver = receiver;
  }

  respond(frame: Uint8Array): void {
    this.outputToSession.next(Buffer.from(frame));
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
  readonly #compatibility: TabbyXtermCompatibilityGate;
  readonly #notifications: NotificationsService;

  constructor(@Inject(NotificationsService) notifications: NotificationsService) {
    super();
    this.#notifications = notifications;
    this.#compatibility = new TabbyXtermCompatibilityGate(reason => {
      console.error("tui-protocol compatibility check failed:", reason);
      notifications.error(`TUI protocol is disabled: ${reason}. Ordinary terminal output remains available.`);
    });
  }

  override attach(terminal: BaseTerminalTabComponent<any>): void {
    const attachSession = (session: BaseSession | null) => {
      this.#detachSession(terminal);
      if (session === null || !(terminal.frontend instanceof XTermFrontend)) return;
      const frontend = terminal.frontend.xterm;
      const middleware = this.#compatibility.activate(
        frontend,
        readTabbyXtermDependency(),
        () => {
          const ordinary = new StreamingOrdinaryWriter({
            write: text => terminal.write(text),
            settle: () => new Promise<void>(resolve => frontend.write("", resolve)),
          });
          let middleware!: TuiProtocolSessionMiddleware;
          const receiver = new TabbyProtocolReceiver({
            terminal: frontend,
            writeOrdinary: data => ordinary.write(data),
            finishOrdinary: () => ordinary.finish(),
            onResponseFrame: frame => middleware.respond(frame),
            onDiagnostic: diagnostic => console.error("tui-protocol:", diagnostic.reason),
            onFailure: error => {
              console.error("tui-protocol receiver failed:", error);
              this.#notifications.error("TUI protocol stopped. Close this tab before retrying.");
            },
          });
          middleware = new TuiProtocolSessionMiddleware(receiver);
          return middleware;
        },
      );
      if (middleware === undefined) return;
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
