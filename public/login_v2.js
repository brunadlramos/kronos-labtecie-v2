// ── KRONOS · LABTECIE — Login Script ─────────────────────────────────────────
// Firebase Authentication

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ── CONFIGURAÇÃO DO FIREBASE ──────────────────────────────────────────────────
// Fonte única em firebase-config.js (B6), carregado antes deste módulo.
const firebaseConfig = window.firebaseConfig;

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ── REDIRECIONAMENTO AUTOMÁTICO SE JÁ LOGADO ──────────────────────────────────
onAuthStateChanged(auth, user => {
  if (user) window.location.href = 'index_v2.html';
});

// ── FUNÇÃO DE LOGIN ───────────────────────────────────────────────────────────
window.doLogin = async function () {
  const email    = document.getElementById('emailInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  const btn      = document.getElementById('loginBtn');
  const err      = document.getElementById('errorMsg');

  err.classList.remove('show');
  err.style.color = '';

  if (!email || !password) {
    err.textContent = 'Preencha e-mail e senha.';
    err.classList.add('show');
    return;
  }

  btn.disabled = true;
  const btnText    = document.getElementById('loginBtnText');
  const btnSpinner = document.getElementById('loginSpinner');
  if(btnText)    { btnText.textContent = 'Entrando…'; }
  if(btnSpinner) { btnSpinner.style.display = 'inline-block'; }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = 'index_v2.html';
  } catch (e) {
    const code = e.code || '';
    console.error('[login] Firebase error:', code, e.message);
    err.textContent = (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found')
      ? 'E-mail ou senha incorretos. Tente novamente.'
      : code === 'auth/too-many-requests'
      ? 'Muitas tentativas. Aguarde alguns minutos.'
      : code === 'auth/network-request-failed'
      ? 'Sem conexão com o servidor. Verifique sua internet.'
      : code === 'auth/user-disabled'
      ? 'Esta conta foi desativada. Contate o administrador.'
      : `Erro ao entrar (${code || 'desconhecido'}). Verifique sua internet.`;
    err.classList.add('show');
    btn.disabled = false;
    if(btnText)    { btnText.textContent = 'Entrar'; }
    if(btnSpinner) { btnSpinner.style.display = 'none'; }
  }
};

// ── ESQUECI A SENHA ───────────────────────────────────────────────────────────
window.doResetPassword = async function () {
  const email = document.getElementById('emailInput').value.trim();
  const err   = document.getElementById('errorMsg');
  err.classList.remove('show');
  err.style.color = '';
  if (!email || !email.includes('@')) {
    err.textContent = 'Digite seu e-mail no campo acima para redefinir a senha.';
    err.classList.add('show');
    document.getElementById('emailInput').focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    err.style.color = '#10b981';
    err.textContent = 'Enviamos um link de redefinição para ' + email + '. Confira sua caixa de entrada (e o spam).';
    err.classList.add('show');
  } catch (e) {
    const code = e.code || '';
    err.style.color = '';
    err.textContent = code === 'auth/user-not-found'
      ? 'E-mail não encontrado. Verifique ou contate o gestor.'
      : code === 'auth/invalid-email'
      ? 'E-mail inválido.'
      : code === 'auth/too-many-requests'
      ? 'Muitas tentativas. Aguarde alguns minutos.'
      : 'Não foi possível enviar o e-mail. Verifique sua internet e tente novamente.';
    err.classList.add('show');
  }
};

// ── ATALHOS DE TECLADO ────────────────────────────────────────────────────────
document.getElementById('passwordInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') window.doLogin();
});
document.getElementById('emailInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('passwordInput').focus();
});
