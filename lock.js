'use strict';
// Passcode lock for the installed web app. The slide data and photos are AES-256-GCM encrypted;
// the key is derived from the passcode with PBKDF2-SHA256 in the browser's Web Crypto API.
// "Remember on this device" stores only the derived key, as a non-extractable CryptoKey in IndexedDB.
(() => {
  const dbName = 'preflight-lock-v1';
  const subtle = crypto.subtle;
  let lockInfo = null;
  let key = null;
  let vault = {};

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function keyStore(mode, action) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = action(db.transaction('keys', mode).objectStore('keys'));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }
  const savedKey = () => keyStore('readonly', store => store.get('deck')).catch(() => null);
  const saveKey = value => keyStore('readwrite', store => store.put(value, 'deck')).catch(() => null);
  const forgetKey = () => keyStore('readwrite', store => store.delete('deck')).catch(() => null);

  const bytes = base64 => Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  async function open(withKey, path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not load ${path}`);
    const sealed = new Uint8Array(await response.arrayBuffer());
    return subtle.decrypt({name: 'AES-GCM', iv: sealed.subarray(0, 12), additionalData: new TextEncoder().encode(path)},
      withKey, sealed.subarray(12));
  }
  async function deriveKey(passcode) {
    const material = await subtle.importKey('raw', new TextEncoder().encode(passcode.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', salt: bytes(lockInfo.salt), iterations: lockInfo.iterations},
      material, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
  }
  async function readDeck(withKey) {
    let plain;
    try { plain = await open(withKey, lockInfo.deck); } catch (error) {
      if (error.name === 'OperationError') return null; // wrong key
      throw error;
    }
    const deck = JSON.parse(new TextDecoder().decode(plain));
    vault = deck.vault || {};
    key = withKey;
    return deck;
  }

  function lockScreen(note) {
    return new Promise(resolve => {
      const screen = document.createElement('div');
      screen.className = 'lock-screen';
      screen.innerHTML = `<form class="lock-card" autocomplete="off">
        <h2>Preflight Photo Practice</h2>
        <p class="lock-note"></p>
        <label for="lock-passcode">Passcode</label>
        <input id="lock-passcode" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" required>
        <label class="lock-remember"><input id="lock-remember" type="checkbox" checked> Remember on this device</label>
        <p class="lock-error" role="alert" hidden></p>
        <button type="submit" class="reset">Unlock</button>
      </form>`;
      screen.querySelector('.lock-note').textContent = note || 'Enter the passcode to open the training slides.';
      document.body.append(screen);
      const form = screen.querySelector('form');
      const input = screen.querySelector('#lock-passcode');
      const error = screen.querySelector('.lock-error');
      const button = screen.querySelector('button');
      input.focus();
      form.addEventListener('submit', async event => {
        event.preventDefault();
        button.disabled = true;
        button.textContent = 'Unlocking…';
        error.hidden = true;
        try {
          const candidate = await deriveKey(input.value);
          const deck = await readDeck(candidate);
          if (!deck) {
            error.textContent = 'That passcode is not correct. Check it and try again.';
            error.hidden = false;
            input.select();
            return;
          }
          if (screen.querySelector('#lock-remember').checked) await saveKey(candidate);
          screen.remove();
          resolve(deck);
        } catch {
          error.textContent = 'Could not open the slides. Check your connection and try again.';
          error.hidden = false;
        } finally {
          button.disabled = false;
          button.textContent = 'Unlock';
        }
      });
    });
  }

  function addLockButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lock-button';
    button.textContent = 'Lock';
    button.title = 'Lock the app and forget the passcode on this device';
    button.addEventListener('click', async () => {
      await forgetKey();
      location.reload();
    });
    document.querySelector('.footer-status')?.append(button);
  }

  async function unlock() {
    const response = await fetch('lock.json');
    if (!response.ok) throw new Error('Lock settings unavailable');
    lockInfo = await response.json();
    let note = null;
    const remembered = await savedKey();
    if (remembered) {
      const deck = await readDeck(remembered);
      if (deck) { addLockButton(); return deck; }
      await forgetKey();
      note = 'The passcode has changed. Enter the new passcode.';
    }
    const deck = await lockScreen(note);
    addLockButton();
    return deck;
  }

  window.PREFLIGHT_LOCK = {
    ready: unlock(),
    // Decrypts one photo and returns a blob URL; the caller revokes it once the image has loaded.
    async imageUrl(src) {
      const [path, type] = vault[src] || [];
      if (!path) throw new Error(`Unknown image: ${src}`);
      return URL.createObjectURL(new Blob([await open(key, path)], {type}));
    },
  };
})();
