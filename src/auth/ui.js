import {authAction} from '../services/auth.js';
import {requireClient} from '../services/supabase.js';
import {authPath} from './routes.js';
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderAuth(root,{mode,returnPath,username='',recovery=false,embedded=false}) {
 const register=mode==='register',recover=mode==='recover',reset=mode==='reset',change=mode==='change';
 const title=change?'Change your password':reset?'Choose a new password':register?'Create an account':recover?'Reset your password':'Sign in';
 root.innerHTML=`${embedded?'<div class="password-settings"><h2>':'<section class="account-card"><h1>'}${title}${embedded?'</h2>':'</h1>'}
  ${embedded?'':`<p>${register?'Your account starts with participant access. Study enrollment is managed by study staff.':recover?'Enter the email address used for your account.':'Use your account to manage setup and view authorized study results.'}</p>`}
  <form id="account-form">
  ${!recover&&!reset&&!change?`<label>Username<input name="username" autocomplete="username" required minlength="${register?3:1}" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9_-]{${register?2:0},31}" value="${escapeHtml(username)}"></label>`:''}
  ${register||recover?'<label>Email<input name="email" type="email" autocomplete="email" required maxlength="254"></label>':''}
  ${change?'<label>Current password<input name="current_password" type="password" autocomplete="current-password" required maxlength="256"></label>':''}
  ${!recover?`<label>${change?'New password':'Password'}<input name="password" type="password" autocomplete="${register||reset||change?'new-password':'current-password'}" required ${register||reset||change?'minlength="12"':''} maxlength="256"></label>`:''}
  ${register||reset||change?'<label>Confirm password<input name="password_confirm" type="password" autocomplete="new-password" required minlength="12" maxlength="256"></label>':''}
  ${register?'<p class="note">Usernames contain 3–32 letters, numbers, underscores or hyphens and start with a letter or number. Matching a historical participant ID does not link past records.</p>':''}
  <button type="submit">${register?'Create account':recover?'Send recovery link':reset||change?'Save password':'Sign in'}</button>
  <p id="auth-status" role="status" aria-live="polite"></p>
  </form>
  ${embedded?'':`<nav>${change?'<a href="/dashboard">My progress</a>':register||recover||reset?`<a href="${escapeHtml(authPath('login',returnPath))}">Back to sign in</a>`:`<a href="${escapeHtml(authPath('register',returnPath))}">Create an account</a> <a href="${escapeHtml(authPath('recover',returnPath))}">Forgot password?</a> <a href="/admin/login">Admin sign in</a>`}</nav>`}
 ${embedded?'</div>':'</section>'}`;
 const form=root.querySelector('form'),status=root.querySelector('#auth-status'),button=form.querySelector('button');
 const usernameInput=form.querySelector('[name=username]');
 usernameInput?.addEventListener('blur',()=>{usernameInput.value=usernameInput.value.trim();});
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  const data=Object.fromEntries(new FormData(form));
  if((register||reset||change) && data.password!==data.password_confirm) {status.textContent='Passwords do not match.';return;}
  button.disabled=true;status.textContent='Please wait…';
  try {
    if(change) {
      await authAction({action:'login',username,password:data.current_password});
      const {error}=await requireClient().auth.updateUser({password:data.password});
      if(error) throw new Error('Could not save your password. Use at least 12 characters and try again.');
      status.textContent='Password saved. Use your new password the next time you sign in.';
      form.reset();
    } else if(reset) {
      if(!recovery) throw new Error('Open a valid recovery link to change your password.');
      const {error}=await requireClient().auth.updateUser({password:data.password});
      if(error) throw new Error('Could not update your password. Request a new recovery link.');
      // Recovery sessions cannot run study tasks until a fresh password sign-in.
      await requireClient().auth.signOut({scope:'local'});
      sessionStorage.removeItem('viewrecovery-recovery');
      status.textContent='Password saved. Sign in with your new password.';
    } else {
      const result=await authAction({action:register?'register':recover?'recover':'login',username:data.username,email:data.email,password:data.password});
      status.textContent=result.message||'Signed in.';
      if(!register&&!recover) {sessionStorage.removeItem('viewrecovery-recovery');location.replace(returnPath);}
      if(register||recover) form.reset();
    }
  } catch(error) {
    if(error.code==='USERNAME_NOT_REGISTERED') {location.assign(authPath('register',returnPath,data.username));return;}
    status.textContent=error.message;
  } finally {button.disabled=false;for(const input of form.querySelectorAll('input[type=password]')) input.value='';}
 });
}
