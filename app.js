const S = {
  token:'', session:'', email:'', username:'',
  mfaSession:'', setupSession:'', mfaUsername:'', displayName:''
};
async function cognitoCall(target, body) {
  const res = await fetch('/api/cognito', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, body })
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}
async function apiCall(path, method, extraHeaders = {}, body = null, key = '') {
  const opts = { method, headers: { 'Authorization': S.token, ...extraHeaders } };
  if (body) opts.body = JSON.stringify(body);
  const qp = new URLSearchParams({ path });
  if (key) qp.set('key', key);
  return fetch('/api/files?' + qp.toString(), opts);
}
function resp(id, msg, type) {
  const el = document.getElementById(id);
  el.className = 'resp' + (msg ? ' show ' + type : '');
  el.textContent = msg;
}
function setStatus(msg, type) {
  document.getElementById('statusMsg').textContent = msg;
  document.getElementById('dot').className = 'dot' + (type ? ' ' + type : '');
}
function toggle(id) {
  document.getElementById('bd-' + id).classList.toggle('open');
  document.getElementById('ch-' + id).classList.toggle('open');
}
function hideAll() {
  ['loginForm','signupForm','verifyBox','forgotBox','resetBox','loggedInBox'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('mfaSection').classList.remove('show');
  document.getElementById('mfaSetupBox').classList.remove('show');
}
function showLoggedIn(name) {
  hideAll();
  document.getElementById('loggedInName').textContent = '👋 Welcome, ' + name;
  document.getElementById('loggedInBox').style.display = 'block';
}
function showLogin()  { hideAll(); document.getElementById('loginForm').style.display  = 'block'; resp('loginResp','',''); }
function showSignup() { hideAll(); document.getElementById('signupForm').style.display = 'block'; resp('signupResp','',''); }
function showForgot() { hideAll(); document.getElementById('forgotBox').style.display  = 'block'; resp('forgotResp','',''); }
function mfaNext(el, i, p) {
  el.value = el.value.replace(/\D/g, '').slice(-1);
  el.classList.toggle('filled', el.value !== '');
  if (el.value && i < 5) document.getElementById(p + (i+1)).focus();
  if (i === 5 && el.value) { p === 'd' ? submitMfa() : confirmSetup(); }
}
function mfaBack(e, i, p) {
  if (e.key === 'Backspace' && !e.target.value && i > 0)
    document.getElementById(p + (i-1)).focus();
}
function mfaPaste(e, p) {
  e.preventDefault();
  const digits = (e.clipboardData || window.clipboardData)
    .getData('text').replace(/\D/g, '').slice(0, 6);
  if (!digits) return;
  digits.split('').forEach((d, idx) => {
    const el = document.getElementById(p + idx);
    if (el) { el.value = d; el.classList.add('filled'); }
  });
  const lastIdx = Math.min(digits.length - 1, 5);
  document.getElementById(p + lastIdx).focus();
  if (digits.length === 6) { p === 'd' ? submitMfa() : confirmSetup(); }
}
function getCode(p) { return [0,1,2,3,4,5].map(i => document.getElementById(p+i).value).join(''); }
function clearCode(p) {
  [0,1,2,3,4,5].forEach(i => {
    const el = document.getElementById(p+i);
    el.value = ''; el.classList.remove('filled');
  });
}
async function login() {
  const identifier = document.getElementById('loginId').value.trim();
  const password   = document.getElementById('password').value;
  if (!identifier || !password) {
    resp('loginResp', '⚠ Please enter your email and password.', 'warn'); return;
  }
  const btn = document.getElementById('loginBtn');
  btn.innerHTML = '<span class="spin"></span>Logging in...'; btn.disabled = true;
  try {
    const data = await cognitoCall('AWSCognitoIdentityProviderService.InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: identifier, PASSWORD: password }
    });

    if (data.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
      S.session = data.Session; S.email = identifier;
      S.mfaUsername = (data.ChallengeParameters && (data.ChallengeParameters.USERNAME || data.ChallengeParameters.USER_ID_FOR_SRP)) || identifier;
      hideAll();
      document.getElementById('mfaEmailDisplay').textContent = identifier;
      document.getElementById('mfaSection').classList.add('show');
      clearCode('d'); document.getElementById('d0').focus();
      setStatus('MFA required — enter your authenticator code', 'warn');

    } else if (data.ChallengeName === 'MFA_SETUP') {
      S.email = identifier;
      S.mfaUsername = (data.ChallengeParameters && (data.ChallengeParameters.USERNAME || data.ChallengeParameters.USER_ID_FOR_SRP)) || identifier;
      const assoc = await cognitoCall('AWSCognitoIdentityProviderService.AssociateSoftwareToken', {
        Session: data.Session
      });
      S.setupSession = assoc.Session;
      hideAll();
      document.getElementById('mfaSetupBox').classList.add('show');
      const secret = assoc.SecretCode;
      const otpUrl = `otpauth://totp/FoxShare:${encodeURIComponent(identifier)}?secret=${secret}&issuer=FoxShare`;
      document.getElementById('qrSetup').innerHTML = '';
      new QRCode(document.getElementById('qrSetup'), { text: otpUrl, width: 160, height: 160 });
      clearCode('s'); document.getElementById('s0').focus();
      setStatus('Scan QR code to set up MFA', 'warn');

    } else if (data.AuthenticationResult) {
      S.token = data.AuthenticationResult.IdToken;
      S.email = identifier;
      try {
        const payload = JSON.parse(atob(S.token.split('.')[1]));
        S.displayName = payload['preferred_username'] || payload['email'] || identifier;
      } catch(e) { S.displayName = identifier; }
      showLoggedIn(S.displayName);
      setStatus('Logged in as ' + S.displayName, 'on');

    } else {
      resp('loginResp', '❌ Unexpected response: ' + JSON.stringify(data), 'err');
    }
  } catch (e) {
    resp('loginResp', '❌ ' + (e.message || JSON.stringify(e)), 'err');
  }
  btn.innerHTML = 'Login'; btn.disabled = false;
}
async function submitMfa() {
  const code = getCode('d');
  if (code.length < 6) { resp('mfaResp', '⚠ Enter all 6 digits.', 'warn'); return; }
  const btn = document.getElementById('mfaBtn');
  btn.innerHTML = '<span class="spin"></span>Verifying...'; btn.disabled = true;
  try {
    const data = await cognitoCall('AWSCognitoIdentityProviderService.RespondToAuthChallenge', {
      ChallengeName: 'SOFTWARE_TOKEN_MFA',
      Session: S.session,
      ChallengeResponses: { USERNAME: S.mfaUsername || S.email, SOFTWARE_TOKEN_MFA_CODE: code }
    });
    if (data.AuthenticationResult) {
      S.token = data.AuthenticationResult.IdToken;
      try {
        const payload = JSON.parse(atob(S.token.split('.')[1]));
        S.displayName = payload['preferred_username'] || payload['email'] || S.email;
      } catch(e) { S.displayName = S.email; }
      document.getElementById('mfaSection').classList.remove('show');
      showLoggedIn(S.displayName);
      setStatus('Logged in as ' + S.displayName, 'on');
    } else {
      resp('mfaResp', '❌ MFA failed: ' + JSON.stringify(data), 'err');
      clearCode('d');
    }
  } catch (e) {
    resp('mfaResp', '❌ ' + (e.message || JSON.stringify(e)), 'err');
    clearCode('d');
  }
  btn.innerHTML = 'Verify Code'; btn.disabled = false;
}
async function confirmSetup() {
  const code = getCode('s');
  if (code.length < 6) { resp('setupResp', '⚠ Enter all 6 digits.', 'warn'); return; }
  const btn = document.getElementById('setupBtn');
  btn.innerHTML = '<span class="spin"></span>Confirming...'; btn.disabled = true;
  try {
    const verifyResult = await cognitoCall('AWSCognitoIdentityProviderService.VerifySoftwareToken', {
      Session: S.setupSession, UserCode: code, FriendlyDeviceName: 'FoxShare'
    });
    const sessionForChallenge = verifyResult.Session || S.setupSession;
    const data = await cognitoCall('AWSCognitoIdentityProviderService.RespondToAuthChallenge', {
      ChallengeName: 'MFA_SETUP', Session: sessionForChallenge,
      ChallengeResponses: { USERNAME: S.mfaUsername || S.email }
    });
    if (data.AuthenticationResult) {
      S.token = data.AuthenticationResult.IdToken;
      try {
        const payload = JSON.parse(atob(S.token.split('.')[1]));
        S.displayName = payload['preferred_username'] || payload['email'] || S.email;
      } catch(e) { S.displayName = S.email; }
      document.getElementById('mfaSetupBox').classList.remove('show');
      showLoggedIn(S.displayName);
      setStatus('MFA set up! Logged in as ' + S.displayName, 'on');
    } else {
      resp('setupResp', '❌ Setup incomplete: ' + JSON.stringify(data), 'err');
    }
  } catch (e) {
    resp('setupResp', '❌ ' + (e.message || JSON.stringify(e)), 'err');
  }
  btn.innerHTML = 'Confirm MFA Setup'; btn.disabled = false;
}
async function signUp() {
  const displayName = document.getElementById('signupDisplayName').value.trim();
  const email       = document.getElementById('signupEmail').value.trim();
  const pwd         = document.getElementById('signupPwd').value;
  const confirm     = document.getElementById('signupConfirm').value;

  if (!email)          { resp('signupResp', '⚠ Please enter your email.', 'warn'); return; }
  if (!pwd)            { resp('signupResp', '⚠ Please enter a password.', 'warn'); return; }
  if (pwd !== confirm) { resp('signupResp', '⚠ Passwords do not match.', 'warn'); return; }
  if (pwd.length < 8)  { resp('signupResp', '⚠ Password must be at least 8 characters.', 'warn'); return; }

  const btn = document.getElementById('signupBtn');
  btn.innerHTML = '<span class="spin"></span>Creating account...'; btn.disabled = true;
  try {
    const attrs = [{ Name: 'email', Value: email }];
    if (displayName) attrs.push({ Name: 'preferred_username', Value: displayName });

    await cognitoCall('AWSCognitoIdentityProviderService.SignUp', {
      Username: email,
      Password: pwd,
      UserAttributes: attrs
    });
    S.username    = email;
    S.email       = email;
    S.displayName = displayName || email;
    hideAll();
    document.getElementById('verifyEmailDisplay').textContent = email;
    document.getElementById('verifyBox').style.display = 'block';
    document.getElementById('verifyCode').focus();
    setStatus('Check your email for a verification code', 'warn');
  } catch (e) {
    resp('signupResp', '❌ ' + (e.message || JSON.stringify(e)), 'err');
  }
  btn.innerHTML = 'Create Account'; btn.disabled = false;
}
async function verifyEmail() {
  const code = document.getElementById('verifyCode').value.trim();
  if (!code) { resp('verifyResp', '⚠ Please enter the verification code.', 'warn'); return; }
  const btn = document.getElementById('verifyBtn');
  btn.innerHTML = '<span class="spin"></span>Verifying...'; btn.disabled = true;
  try {
    await cognitoCall('AWSCognitoIdentityProviderService.ConfirmSignUp', {
      Username: S.username, ConfirmationCode: code
    });
    showLogin();
    document.getElementById('loginId').value = S.email;
    resp('loginResp', '✅ Email verified! Login with your email and password.', 'ok');
    setStatus('Email verified — login below', 'on');
  } catch (e) {
    resp('verifyResp', '❌ ' + (e.message || JSON.stringify(e)), 'err');
  }
  btn.innerHTML = 'Verify Email'; btn.disabled = false;
}
async function resendCode() {
  const btn = document.getElementById('resendBtn');
  btn.innerHTML = '<span class="spin"></span>Sending...'; btn.disabled = true;
  try {
    await cognitoCall('AWSCognitoIdentityProviderService.ResendConfirmationCode', {
      Username: S.username
    });
    resp('verifyResp', '✅ New code sent — check your email.', 'ok');
  } catch (e) {
    resp('verifyResp', '❌ ' + (e.message || JSON.stringify(e)), 'err');
  }
  btn.innerHTML = 'Resend Code'; btn.disabled = false;
}
async function forgotPassword() {
  const email = document.getElementById('forgotEmail').value.trim();
  if (!email) { resp('forgotResp', '⚠ Please enter your email.', 'warn'); return; }
  const btn = document.getElementById('forgotBtn');
  btn.innerHTML = '<span class="spin"></span>Sending...'; btn.disabled = true;
  try {
    await cognitoCall('AWSCognitoIdentityProviderService.ForgotPassword', { Username: email });
    S.email = email;
    document.getElementById('forgotBox').style.display = 'none';
    document.getElementById('resetBox').style.display  = 'block';
    setStatus('Check your email for a reset code', 'warn');
  } catch (e) {
    resp('forgotResp', '❌ ' + (e.message || JSON.stringify(e)), 'err');
  }
  btn.innerHTML = 'Send Reset Code'; btn.disabled = false;
}
async function resetPassword() {
  const code    = document.getElementById('resetCode').value.trim();
  const pwd     = document.getElementById('resetPwd').value;
  const confirm = document.getElementById('resetConfirm').value;
  if (!code)           { resp('resetResp', '⚠ Enter the reset code.', 'warn'); return; }
  if (!pwd)            { resp('resetResp', '⚠ Enter a new password.', 'warn'); return; }
  if (pwd !== confirm) { resp('resetResp', '⚠ Passwords do not match.', 'warn'); return; }
  if (pwd.length < 8)  { resp('resetResp', '⚠ Password must be at least 8 characters.', 'warn'); return; }
  const btn = document.getElementById('resetBtn');
  btn.innerHTML = '<span class="spin"></span>Resetting...'; btn.disabled = true;
  try {
    await cognitoCall('AWSCognitoIdentityProviderService.ConfirmForgotPassword', {
      Username: S.email, ConfirmationCode: code, Password: pwd
    });
    showLogin();
    document.getElementById('loginId').value = S.email;
    resp('loginResp', '✅ Password reset! You can now log in.', 'ok');
    setStatus('Password reset — login below', 'on');
  } catch (e) {
    resp('resetResp', '❌ ' + (e.message || JSON.stringify(e)), 'err');
  }
  btn.innerHTML = 'Reset Password'; btn.disabled = false;
}
function logout() {
  S.token = ''; S.session = ''; S.email = ''; S.username = '';
  document.getElementById('filesList').innerHTML = '';
  showLogin();
  setStatus('Logged out', '');
}

const MAX_SIZE_MB    = 50;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

let selectedFile = null;
function fileSelected(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > MAX_SIZE_BYTES) {
    resp('uploadResp', `❌ File too large — maximum allowed size is ${MAX_SIZE_MB} MB.`, 'err');
    input.value = '';
    selectedFile = null;
    document.getElementById('dropName').textContent = '';
    return;
  }
  selectedFile = file;
  document.getElementById('dropName').textContent = '📎 ' + file.name;
}
async function uploadFile() {
  if (!S.token)      { resp('uploadResp', '⚠ Please login first.', 'warn'); return; }
  if (!selectedFile) { resp('uploadResp', '⚠ Please select a file.', 'warn'); return; }

  // Client-side size check before making any network request
  if (selectedFile.size > MAX_SIZE_BYTES) {
    resp('uploadResp', `❌ File too large — maximum allowed size is ${MAX_SIZE_MB} MB.`, 'err');
    return;
  }

  const btn = document.getElementById('uploadBtn');
  btn.innerHTML = '<span class="spin"></span>Requesting upload URL...'; btn.disabled = true;
  try {
    const res = await apiCall('/files', 'POST', { 'Content-Type': 'application/json' },
                              { file_name: selectedFile.name });
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch(e) { data = { message: raw }; }

    if (!res.ok) {
      const errText = data.error || data.message || JSON.stringify(data);
      const isType  = errText.includes('type') || errText.includes('extension');
      resp('uploadResp', isType ? '❌ File type not allowed.' : '❌ Upload failed: ' + errText, 'err');
      return;
    }

    if (!data.upload_url || !data.upload_fields) {
      resp('uploadResp', '❌ No presigned URL returned from server.', 'err');
      return;
    }

    btn.innerHTML = '<span class="spin"></span>Uploading & encrypting...';
    const form = new FormData();
    Object.entries(data.upload_fields).forEach(([k, v]) => form.append(k, v));
    form.append('file', selectedFile);

    const s3res = await fetch(data.upload_url, { method: 'POST', body: form });
    if (s3res.ok || s3res.status === 204) {
      resp('uploadResp', '✅ ' + selectedFile.name + ' uploaded and encrypted successfully!', 'ok');
      selectedFile = null;
      document.getElementById('dropName').textContent = '';
      document.getElementById('fileInput').value = '';
    } else {
      const s3err = await s3res.text();
      const match = s3err.match(/<Message>(.*?)<\/Message>/);
      const msg   = match ? match[1] : ('S3 error ' + s3res.status);
      resp('uploadResp', msg.toLowerCase().includes('length') || msg.toLowerCase().includes('size')
        ? '❌ File too large — maximum allowed size is 50 MB.'
        : '❌ Upload failed: ' + msg, 'err');
    }
  } catch (e) {
    resp('uploadResp', '❌ ' + e.message, 'err');
  }
  btn.innerHTML = 'Upload & Encrypt File'; btn.disabled = false;
}
async function listFiles() {
  if (!S.token) { resp('listResp', '⚠ Please login first.', 'warn'); return; }
  const btn = document.getElementById('listBtn');
  btn.innerHTML = '<span class="spin"></span>Loading...'; btn.disabled = true;
  try {
    const res = await apiCall('/files', 'GET');
    const raw = await res.text();
    let data; try { data = JSON.parse(raw); } catch(e) { data = { message: raw }; }
    if (!res.ok) { resp('listResp', '❌ ' + (data.message || JSON.stringify(data)), 'err'); return; }
    const files = data.files || [];
    resp('listResp', files.length ? '' : 'No files yet — upload something!', files.length ? '' : 'inf');
    const list = document.getElementById('filesList');
    list.innerHTML = '';
    const icons = { pdf:'📄',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',ppt:'📋',pptx:'📋',
      jpg:'🖼',jpeg:'🖼',png:'🖼',gif:'🖼',webp:'🖼',svg:'🖼',
      zip:'🗜',mp4:'🎬',mp3:'🎵',txt:'📃',csv:'📊',json:'🔧',xml:'🔧',md:'📃' };
    files.forEach(f => {
      const ext  = f.file_name.split('.').pop().toLowerCase();
      const icon = icons[ext] || '📁';
      const kb   = (f.size / 1024).toFixed(1);
      const date = new Date(f.last_modified).toLocaleDateString();
      const div  = document.createElement('div');
      div.className = 'file-item';
      div.innerHTML = `
        <div class="file-icon">${icon}</div>
        <div class="file-info">
          <div class="file-name">${f.file_name}</div>
          <div class="file-meta">${kb} KB · ${date}</div>
        </div>
        <div class="file-actions">
          <button class="btn btn-sm btn-dl"    onclick="downloadFile('${f.s3_key}','${f.file_name}')">⬇ Download</button>
          <button class="btn btn-sm btn-share" onclick="shareFile('${f.s3_key}',this)">🔗 Share</button>
          <button class="btn btn-sm btn-del"   onclick="deleteFile('${f.s3_key}',this)">🗑 Delete</button>
        </div>`;
      list.appendChild(div);
    });
  } catch (e) {
    resp('listResp', '❌ ' + e.message, 'err');
  }
  btn.innerHTML = 'Refresh My Files'; btn.disabled = false;
}
async function downloadFile(key, name) {
  if (!S.token) return;
  try {
    const res = await apiCall('/files/share', 'GET', {}, null, key);
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch(e) { data = {}; }
    if (!res.ok || (!data.download_url && !data.share_url)) {
      alert('Download failed: could not get download link'); return;
    }
    const dlUrl  = data.download_url || data.share_url;
    const s3res  = await fetch(dlUrl);
    if (!s3res.ok) { alert('Download failed'); return; }
    const blob    = await s3res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
  } catch (e) { alert('Download error: ' + e.message); }
}
async function shareFile(key, btn) {
  if (!S.token) return;
  btn.innerHTML = '<span class="spin"></span>'; btn.disabled = true;
  try {
    const res = await apiCall('/files/share', 'GET', {}, null, key);
    const raw = await res.text();
    let data; try { data = JSON.parse(raw); } catch(e) { data = { message: raw }; }
    if (res.ok && data.share_url) {
      const url = data.share_url;
      btn.closest('.file-item').insertAdjacentHTML('afterend',
        `<div class="share-box show" style="margin-bottom:8px;">
          <span class="share-url">${url}</span>
          <button class="btn btn-sm btn-share" onclick="navigator.clipboard.writeText('${url}');this.textContent='Copied!'">Copy</button>
        </div>`);
    } else {
      alert('Share failed: ' + JSON.stringify(data));
    }
  } catch (e) { alert('Share error: ' + e.message); }
  btn.innerHTML = '🔗 Share'; btn.disabled = false;
}
async function deleteFile(key, btn) {
  if (!S.token) return;
  if (!confirm('Delete this file? This cannot be undone.')) return;
  btn.innerHTML = '<span class="spin"></span>'; btn.disabled = true;
  try {
    const res = await apiCall('/files/delete', 'DELETE', {}, null, key);
    if (res.ok) { listFiles(); }
    else {
      const raw = await res.text();
      let data; try { data = JSON.parse(raw); } catch(e) { data = { message: raw }; }
      alert('Delete failed: ' + (data.message || JSON.stringify(data)));
      btn.innerHTML = '🗑 Delete'; btn.disabled = false;
    }
  } catch (e) {
    alert('Delete error: ' + e.message);
    btn.innerHTML = '🗑 Delete'; btn.disabled = false;
  }
}
const dz = document.getElementById('dropzone');
dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (f.size > MAX_SIZE_BYTES) {
    resp('uploadResp', `❌ File too large — maximum allowed size is ${MAX_SIZE_MB} MB.`, 'err');
    return;
  }
  selectedFile = f;
  document.getElementById('dropName').textContent = '📎 ' + f.name;
});
new QRCode(document.getElementById('qrcode'), { text: window.location.href, width: 120, height: 120 });
