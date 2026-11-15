import { MIN_PASSWORD, NAME_RE, type UserView } from '@dropzone/shared';
import { auth } from '../net';
import { h } from './dom';

export function loginScreen(onDone: (u: UserView) => void): HTMLElement {
  let mode: 'login' | 'register' = 'login';
  const name = h('input', { placeholder: 'Username', autocomplete: 'username', maxLength: 16, spellcheck: false }) as HTMLInputElement;
  const pass = h('input', { placeholder: 'Password', type: 'password', autocomplete: 'current-password' }) as HTMLInputElement;
  const err = h('div.form-error');
  const submit = h('button.btn.btn-primary.wide', { type: 'submit' }, 'SIGN IN') as HTMLButtonElement;
  const swap = h('button.link', { type: 'button' }, 'New here? Create an account');
  const guest = h('button.btn.btn-ghost.wide', { type: 'button' }, 'PLAY AS GUEST') as HTMLButtonElement;

  const busy = (b: boolean) => { submit.disabled = guest.disabled = b; };
  const fail = (e: unknown) => { err.textContent = (e as Error).message; busy(false); };

  swap.onclick = () => {
    mode = mode === 'login' ? 'register' : 'login';
    submit.textContent = mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT';
    swap.textContent = mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in';
    pass.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    err.textContent = '';
  };
  guest.onclick = () => { busy(true); auth.guest().then(onDone, fail); };

  const form = h('form.login-card', {
    onsubmit: (e: Event) => {
      e.preventDefault();
      err.textContent = '';
      if (!NAME_RE.test(name.value.trim())) return (err.textContent = 'Name must be 3-16 letters, numbers or _');
      if (pass.value.length < MIN_PASSWORD) return (err.textContent = `Password must be at least ${MIN_PASSWORD} characters`);
      busy(true);
      (mode === 'login' ? auth.login : auth.register)(name.value.trim(), pass.value).then(onDone, fail);
    },
  },
    h('div.logo.big', h('span', 'DROP'), h('span.accent', 'ZONE')),
    h('div.tagline', 'No builds. Last squad standing.'),
    name, pass, err, submit, swap,
    h('div.divider', h('span', 'or')),
    guest,
    h('div.fineprint', 'Guest progress is saved on this browser only.'),
  );
  setTimeout(() => name.focus(), 50);
  return h('div.screen.login', form);
}
