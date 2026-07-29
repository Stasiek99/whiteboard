# Whiteboard — Real-Time Collaborative Drawing Board

**A multi-user whiteboard where every stroke, shape, and cursor syncs live across all connected tabs — built with Angular signals and Socket.io.**

![Angular](https://img.shields.io/badge/Angular-21-dd0031?logo=angular&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white)
![Socket.io](https://img.shields.io/badge/Realtime-Socket.io-010101?logo=socket.io&logoColor=white)
![Deployed on Netlify](https://img.shields.io/badge/Frontend-Netlify-00c7b7?logo=netlify&logoColor=white)
![Deployed on Railway](https://img.shields.io/badge/Backend-Railway-0b0d0e?logo=railway&logoColor=white)

**Live site:** [whiteboard-workspace.netlify.app](https://whiteboard-workspace.netlify.app)
**GitHub:** [github.com/Stasiek99/whiteboard](https://github.com/Stasiek99/whiteboard)

🇬🇧 English | [🇵🇱 Polski](README.pl.md)

---

## What it is

A real-time collaborative whiteboard built as an npm monorepo — an Angular 21 frontend (standalone components, signals, native Canvas API) paired with a Node.js/Express + Socket.io backend. Every user connected to a board draws on a shared canvas, sees everyone else's cursor labeled and in motion, and joins mid-session to a board that's already fully populated from server state.

---

## Screenshots

### Canvas — freehand drawing, shapes & color

![Canvas](images/canvas.png)

### Toolbar — tools, color palette & stroke width

![Toolbar](images/toolbar.png)

---

## Features

### Drawing Engine
- **Freehand pen** — smooth strokes rendered on a `requestAnimationFrame` loop, only repainting when the board is actually dirty
- **Eraser, rectangle & ellipse** — shape preview drawn on a transparent overlay canvas, committed on pointer release
- **Color picker & stroke width** — swatches plus a custom color input and a live width slider
- **Undo & clear board**
- **DPI-aware rendering** — canvas is scaled for `devicePixelRatio`, so strokes stay pixel-perfect under the cursor on retina displays
- **Normalized coordinate space** — every point is stored as a 0.0–1.0 float relative to canvas size, not raw pixels, so drawings survive window resizes and different screen sizes without drifting

### Real-Time Collaboration
- **Live sync via Socket.io** — strokes, shapes, erases and clears broadcast to every client in the room the instant a pointer is released
- **Board state replay** — a client joining mid-session receives the full action log before anything else, so it renders the exact same board as everyone already there
- **Auto-reconnect** — on connection loss, the client automatically rejoins the board and resyncs when the network returns
- **Bounded server memory** — each room's action log is capped, and idle rooms are cleaned up after 30 minutes of inactivity

### Multi-Cursor Overlay
- **Labeled remote cursors** — every connected user gets a named, colored cursor rendered live over the canvas
- **Randomly generated identity** — adjective + noun + number, persisted per tab session so a page refresh doesn't spawn a new user
- **Idle fade-out** — a cursor that stops moving for a few seconds hides gracefully instead of cluttering the board
- **Throttled cursor stream** — cursor position is rate-limited before being emitted over the socket, keeping bandwidth and CPU usage low even with several active users

### Infrastructure
- **Angular 21** — standalone components, signals-based state, zoneless pointer handling for smooth interaction under heavy drawing load
- **E2E tests** — Playwright, covering multi-tab drawing sync, cursor visibility and reconnection behaviour
- **Unit tests** — Vitest on both the Angular client and the Node.js server
- **CI/CD** — frontend on Netlify, WebSocket server on Railway, environment-based socket URL configuration

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 21 (standalone, signals) |
| Rendering | Native Canvas API + `requestAnimationFrame` |
| Realtime | Socket.io (client & server) |
| Backend | Node.js + Express |
| Language | TypeScript |
| Reactive state | RxJS 7.8 |
| Unit tests | Vitest |
| E2E tests | Playwright |
| Frontend hosting | Netlify |
| Backend hosting | Railway |
| Monorepo | npm workspaces |
