# Login-screen [Connect Wallet]

A new player can connect a Solana wallet **before** they start playing, from the
login/title screen. The button sits next to the existing **Install App**
affordance and uses the same provider lookup, connect flow and persisted wallet
record as the in-game HUD wallet panel.

## Files

| File | Role |
| --- | --- |
| `src/ui/LoginWallet.js` | NEW. The DOM `[Connect Wallet]` button + hint toast on the login screen. |
| `src/ui/walletConnect.js` | NEW. Shared Solana plumbing (provider lookup, connect flow, storage, address truncation). |
| `src/ui/WalletPanel.js` | In-game HUD panel — now imports the shared helpers instead of its own copies. Behaviour unchanged. |
| `src/main.js` | One init line: `installLoginWallet()`. |
| `index.html` | Unchanged — the button and hint are appended to `<body>` by JS, no mount point required. |

`npx vite build` copies `public/` verbatim and bundles `src/`; this is a static
site, so nothing server-side changes.

## Why DOM (not a Phaser object)

The login screen is a raw HTML5 `<video>` behind a **transparent** Phaser canvas
(`render.transparent`, `backgroundColor: 0x00000000`, never `setBackgroundColor`).
Wallet extensions and browsers require the `connect()` call to happen inside a
genuine user gesture, so the trigger has to be a real `<button>`. Doing it in DOM
also avoids editing `src/scenes/TitleScene.js`, which owns the canvas-side layout.

The button mirrors `src/ui/PwaInstall.js`: a `position: fixed` pill at
`z-index: 8` — above the game canvas (z 1), below the boot splash (z 10).

## Placement

`TitleScene` lays its menu out in logical units and centres it with the menu
camera (`src/core/display.js`). `LoginWallet` maps a logical point to CSS pixels
through `cameras.main` (scroll + zoom) and the canvas' on-screen box (so
safe-area insets and DPR scaling are handled):

* **Install App button on screen** → the button is anchored *beside* it; on a
  narrow screen where side-by-side would overflow, it stacks *above* it instead.
* **No Install App button** → it takes the same bottom strip slot (centred).

The position is re-evaluated every 500 ms and on `resize`, so it can never creep
onto the login name field or the two title buttons (`BEGIN YOUR JOURNEY` /
`ENTER THE PUBLIC WORLD`). It is shown only while the `title` scene is active —
in-game, the HUD `WalletPanel` owns the wallet UI.

## Behaviour

* **Not connected** → `🔐 Connect Wallet`. Clicking calls
  `provider.connect()` (Phantom first, then Solflare) and persists
  `{ addr, provider, network }` under the same `wayfarer.wallet.v1` key the HUD
  panel uses.
* **Connected** → `🔐 4xAb..9zQ ✕` — the truncated public address; clicking it
  disconnects (clears storage, best-effort `provider.disconnect()`).
* **No wallet installed** → a non-blocking hint: *"No Solana wallet found —
  install Phantom or Solflare to connect."* Nothing throws, the page keeps
  working.
* **User declines** → *"Wallet connection cancelled — you can try again any
  time."* No uncaught error.

Persistence: the wallet is restored on reload from the shared storage key, so the
login button and the in-game `WalletPanel` always agree.

## Security

Public addresses only. No private key is ever requested, stored or logged, and no
full address is written to the console — only a truncated form is displayed.
