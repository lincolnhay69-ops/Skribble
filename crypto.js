var SALT = new TextEncoder().encode('ScribbleSalt2025_v2');
var cryptoKeyCache = {};

function bufToBase64(buf) {
  var bytes = new Uint8Array(buf);
  var binary = '';
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBuf(base64) {
  var binary = atob(base64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function getCryptoKey(convPath) {
  if (cryptoKeyCache[convPath]) return Promise.resolve(cryptoKeyCache[convPath]);
  return crypto.subtle.importKey('raw', new TextEncoder().encode(convPath), { name: 'PBKDF2' }, false, ['deriveKey'])
    .then(function(baseKey) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: SALT, iterations: 100000, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    }).then(function(key) {
      cryptoKeyCache[convPath] = key;
      return key;
    });
}

function encryptMessage(plaintext, convPath) {
  var iv = crypto.getRandomValues(new Uint8Array(12));
  return getCryptoKey(convPath).then(function(key) {
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(plaintext));
  }).then(function(ciphertext) {
    return { ciphertext: bufToBase64(ciphertext), iv: bufToBase64(iv) };
  });
}

function decryptMessage(ciphertextB64, ivB64, convPath) {
  var iv = base64ToBuf(ivB64);
  var ciphertext = base64ToBuf(ciphertextB64);
  return getCryptoKey(convPath).then(function(key) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ciphertext);
  }).then(function(decrypted) {
    return new TextDecoder().decode(decrypted);
  });
}
