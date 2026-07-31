# RFC 0001: Mutable Terminal History and Reading Anchors

| Field | Value |
|---|---|
| Status | Draft |
| Author | HelloWorldU |
| Created | 2026-07-31 |

## Abstract

This RFC frames a protocol for identified, mutable content in terminal-owned
history, allowing applications to update logical blocks while terminals
preserve native scrollback and stable reading positions.

## Background

AI coding assistants and agentic tools have created long-running, dynamic TUI
sessions in which earlier content continues to finalize, expand, shrink, and
reflow. Users still expect to review that content through terminal-owned
scrollback and its native reading capabilities.

Existing terminal protocols let applications edit the active screen, but do
not give historical content stable logical identity. Differential redraw
cannot generally reach anonymous rows already in scrollback, while destructive
clear-and-replay can erase history, duplicate content, or move the user's
reading position.

The missing contract is not a new redraw algorithm. Applications need to
express the identity and revision of logical content; terminals need to apply
those updates to their own history and preserve the user's reading position.
This resembles targeted updates to identified document nodes, without
requiring the terminal to become a browser or expose a DOM.

## Goals

The project explores whether a terminal protocol can provide all three of
these properties together:

1. Preserve terminal-owned scrollback and the native terminal capabilities
   built around it.
2. Update or reflow dynamic content after it has left the active screen.
3. Keep the user's reading position anchored to logical content when output
   continues or content above it changes.
