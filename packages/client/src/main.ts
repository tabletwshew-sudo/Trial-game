import './styles.css';
import type { UserView } from '@dropzone/shared';
import { auth, Net } from './net';
import { loginScreen } from './ui/login';
import { lobbyScreen } from './ui/lobby';
import { gameScreen } from './game/game';
import { h } from './ui/dom';

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
  const lobby = lobbyScreen(n, user, async () => { await auth.logout(); showLogin(); }, (match) => {
    const game = gameScreen(n, user, match, (again) => showLobby(user, !!again));
    show(game.el, game.destroy);
  }, playAgain);
  show(lobby.el, lobby.destroy);
}

auth.me().then(
  (u) => (u ? enterLobby(u) : showLogin()),
  () => show(h('div.screen.login', h('div.login-card', h('div.logo.big', h('span', 'DROP'), h('span.accent', 'ZONE')),
    h('div.form-error', "Can't reach the game server."), h('button.btn.btn-primary.wide', { onclick: () => location.reload() }, 'RETRY')))),
);
