import './styles.css';
import type { UserView } from '@dropzone/shared';
import { auth, Net } from './net';
import { loginScreen } from './ui/login';
import { lobbyScreen } from './ui/lobby';
import { gameScreen } from './game/game';
import { h } from './ui/dom';
import { audio } from './audio';
import { charSheet } from './lobby/charsheet';

// browsers only allow sound after a click or key press
const unlock = () => audio.unlock();
addEventListener('pointerdown', unlock, true);
addEventListener('keydown', unlock, true);
(window as unknown as { __audio: typeof audio }).__audio = audio; // test hook
document.addEventListener('click', (e) => { if ((e.target as HTMLElement | null)?.closest?.('button')) audio.ui('click'); }, true);

const app = document.getElementById('app')!;
let current: { destroy?: () => void } | null = null;
let net: Net | null = null;

function show(el: HTMLElement, destroy?: () => void) {
  current?.destroy?.();
  app.replaceChildren(el);
  current = { destroy };
}

function showLogin() {
  net?.close(); net = null;
  audio.setMusic('lobby');
  show(loginScreen(enterLobby));
}

function enterLobby(user: UserView) {
  net?.close();
  net = new Net();
  showLobby(user);
  net.connect();
}

function showLobby(user: UserView, playAgain = false) {
  const n = net!;
  audio.setMusic('lobby');
  const lobby = lobbyScreen(n, user, async () => { await auth.logout(); showLogin(); }, (match) => {
    audio.ui('found');
    audio.setMusic(null);
    const game = gameScreen(n, user, match, (again) => showLobby(user, !!again));
    show(game.el, game.destroy);
  }, playAgain);
  show(lobby.el, lobby.destroy);
}

if (new URLSearchParams(location.search).has('charsheet')) charSheet(app);
else auth.me().then(
  (u) => (u ? enterLobby(u) : showLogin()),
  () => show(h('div.screen.login', h('div.login-card', h('div.logo.big', h('span', 'DROP'), h('span.accent', 'ZONE')),
    h('div.form-error', "Can't reach the game server."), h('button.btn.btn-primary.wide', { onclick: () => location.reload() }, 'RETRY')))),
);
