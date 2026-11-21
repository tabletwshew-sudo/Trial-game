# Mobile: touch controls and a layout editor

Dropzone now plays on phones and tablets in the browser.

## Controls
- **Turning on:** touch controls switch on by themselves when the main pointer is a finger. Settings → Controls → Touch controls can force them On or Off. Touchscreen laptops keep mouse and keyboard.
- **Moving:**
  - A joystick appears under your left thumb.
  - Push it all the way forward to sprint (the knob turns yellow).
- **Looking:** drag anywhere on the right. Look speed is in Settings → Controls. Aim and scope multipliers still apply.
- **Firing:**
  - There are two fire buttons, one for each thumb.
  - Holding fire or aim and dragging keeps turning you, so you can follow a target.
- **Other buttons:** aim, jump, crouch, reload, interact, pickaxe, inventory, map, mark a spot, emote (hidden by default) and menu.
- **Hotbar:** in touch mode it moves to bottom-centre, between the thumbs. Tap a slot to hold it.
- **Pause menu:** the keyboard list is skipped so it fits a phone screen.
- **Portrait:** holding the phone upright shows a "turn your phone sideways" screen.

## Layout editor
Open it with ✎ (top left, next to the menu button) or **Menu → Edit touch layout**.
- **Move:** drag any button.
- **Resize:** tap a button to pick it, then use − / +.
- **Hide or show:** use HIDE / SHOW on the picked button. Hidden buttons show faded while editing.
- **Opacity:** OPACITY cycles every button through 100 / 85 / 65 / 45 %.
- **Finish:**
  - SAVE keeps the layout on this device (`localStorage`, `dz.touchLayout`).
  - CANCEL undoes this session's edits.
  - RESET restores the default layout.

Positions are stored as a percentage of the screen, so a layout carries across phone sizes.

## Also
- On phone-sized screens the HUD shrinks to 72 % of your HUD size setting.
- On short landscape screens the lobby and sign-in screen are more compact, and the news card is hidden.

## Code
- **`packages/client/src/game/touch.ts`:** `TouchControls` (pointer events, multi-touch) and the editor.
- **`Input`:**
  - Has a `touch` mode: no pointer lock; `lock()` / `unlock()` only flip `locked`.
  - Gets `touchBits`, which are OR'ed into `keys`.
  - Gets `touchLook(dx, dy)`.
- **Tests:** `tests/e2e/touch.e2e.cjs` runs on an emulated Pixel 7 in landscape with real multi-touch through the DevTools protocol. It checks:
  - running and sprinting with the joystick while a second finger looks round;
  - the fire bit;
  - hotbar taps;
  - the menu;
  - moving and resizing a button and saving the layout;
  - the portrait hint.
