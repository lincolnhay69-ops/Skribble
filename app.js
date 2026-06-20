var currentUser = null;
var currentChannelId = null;
var currentDmId = null;
var currentGroupId = null;
var currentMsgQuery = null;
var currentTypingRef = null;
var dmListVersion = 0;
var ADMIN_UID = 'wVaQg5UcbIS1DavXddSMoMg8etB2';
var selectedProfileUid = null;
var isWindowFocused = true;
var friendRequestCount = 0;

if (window.__TAURI__) {
  window.__TAURI__.event.listen('tauri://focus', function() {
    isWindowFocused = true;
    updateOnlineStatus();
    var dot = document.getElementById('own-status-dot');
    if (dot) dot.className = 'status-dot online';
  });
  window.__TAURI__.event.listen('tauri://blur', function() {
    isWindowFocused = false;
    updateOnlineStatus();
    var dot = document.getElementById('own-status-dot');
    if (dot) dot.className = 'status-dot away';
  });
  // Listen for notification clicks globally
  window.__TAURI__.event.listen('notification', function() {
    window.__TAURI__.core.invoke('show_window').catch(function(e) {
      console.error('show_window failed:', e);
    });
  });
}

function updateOnlineStatus() {
  if (!auth.currentUser) return;
  db.ref('users/' + auth.currentUser.uid + '/status').set({
    online: true,
    focus: isWindowFocused,
    lastSeen: firebase.database.ServerValue.TIMESTAMP
  });
}

function listenForFriendRequests() {
  var myUid = auth.currentUser.uid;
  db.ref('friendRequests').orderByChild('to').equalTo(myUid).on('value', function(snapshot) {
    var prevCount = friendRequestCount;
    friendRequestCount = 0;
    var newestRequest = null;
    var pendingFrom = [];

    snapshot.forEach(function(child) {
      var req = child.val();
      if (req.status === 'pending') {
        pendingFrom.push(req.from);
        if (!newestRequest || (req.createdAt || 0) > (newestRequest.createdAt || 0)) {
          newestRequest = req;
        }
      }
    });

    if (pendingFrom.length === 0) {
      updateFriendBadge(0, null, prevCount, isWindowFocused);
      return;
    }

    // Filter out blocked users
    db.ref('users/' + myUid + '/blocked').once('value', function(blockSnap) {
      var blockedMap = blockSnap.val() || {};
      pendingFrom.forEach(function(fromUid) {
        if (!blockedMap[fromUid]) friendRequestCount++;
      });
      updateFriendBadge(friendRequestCount, newestRequest, prevCount, isWindowFocused);
    });
  });
}

function updateFriendBadge(count, newestRequest, prevCount, windowFocused) {
  var badge = document.getElementById('friend-request-badge');
  if (badge) {
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
  }
  if (newestRequest && count > prevCount && !windowFocused) {
    db.ref('users/' + newestRequest.from + '/displayName').once('value', function(nameSnap) {
      notifyMessage({ senderName: nameSnap.val() || 'Someone', text: 'Sent you a friend request' }, 'Friend Request');
    });
  }
}

var channelIcons = {
  general: '<svg viewBox="0 0 16 16" width="16" height="16" style="vertical-align:middle;" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2.5h12A1.5 1.5 0 0115.5 4v7a1.5 1.5 0 01-1.5 1.5H4l-2.5 2V4A1.5 1.5 0 012 2.5z"/></svg>',
  random: '<svg viewBox="0 0 16 16" width="16" height="16" style="vertical-align:middle;" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="1.5" width="13" height="13" rx="2" ry="2"/><circle cx="5" cy="5" r="1"/><circle cx="11" cy="11" r="1"/><circle cx="5" cy="11" r="1" fill="currentColor"/><circle cx="11" cy="5" r="1" fill="currentColor"/></svg>',
  'off-topic': '<svg viewBox="0 0 16 16" width="16" height="16" style="vertical-align:middle;" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 3h10v6A3.5 3.5 0 018 12.5H5A3.5 3.5 0 011.5 9V3z"/><path d="M11.5 6h1a2 2 0 010 4h-1"/></svg>',
  announcements: '<svg viewBox="0 0 16 16" width="16" height="16" style="vertical-align:middle;" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7a2 2 0 014 0v3a2 2 0 01-4 0V7z"/><path d="M6 7l5-3v9l-5-3"/><path d="M12.5 6A3.5 3.5 0 0114 8a3.5 3.5 0 01-1.5 2"/></svg>'
};

auth.onAuthStateChanged(function(user) {
  if (user) {
    currentUser = user;
    initApp();
  }
});

function initApp() {
  seedChannels();
  updateOnlineStatus();

  var avatarContainer = document.getElementById('user-avatar');
  if (avatarContainer && currentUser.displayName) {
    db.ref('users/' + currentUser.uid + '/avatarColour').once('value', function(snapshot) {
      var colour = snapshot.val() || '#2d5da1';
      avatarContainer.innerHTML = '<div class="avatar-wrap"><span class="avatar avatar-sm" style="cursor:pointer;background:' + colour + ';" onclick="window.location.href=\'profile.html\'">' + currentUser.displayName.charAt(0).toUpperCase() + '</span><span class="status-dot ' + (isWindowFocused ? 'online' : 'away') + '" id="own-status-dot"></span></div>';
    });
  }

  loadChannels();
  loadDMs();
  loadGroups();
  reportVersion();
  applyUISettings();
  showReleaseNotes();
  if (window.__TAURI__) {
    window.__TAURI__.event.listen('before-quit', function() {
      db.ref('users/' + auth.currentUser.uid + '/status').set({ online: false }).then(function() {
        window.__TAURI__.core.invoke('quit_app');
      });
    });
  }
  setupNotificationListeners();
  checkForUpdates();
  listenForFriendRequests();
  switchToChannel('general');

  var typingTimeout = null;
  document.getElementById('message-input').addEventListener('input', function() {
    var uid = auth.currentUser.uid;
    var path = currentChannelId ? 'channels/' + currentChannelId + '/typing/' + uid
             : currentDmId ? 'dms/' + currentDmId + '/typing/' + uid
             : currentGroupId ? 'groups/' + currentGroupId + '/typing/' + uid
             : null;
    if (!path) return;
    db.ref(path).set(firebase.database.ServerValue.TIMESTAMP);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(function() {
      db.ref(path).remove();
    }, 2000);
  });
}

function seedChannels() {
  var names = ['general', 'random', 'off-topic', 'announcements'];
  var channelsRef = db.ref('channels');
  channelsRef.once('value').then(function(snapshot) {
    names.forEach(function(name) {
      if (!snapshot.hasChild(name)) {
        channelsRef.child(name).set({ name: name, createdAt: firebase.database.ServerValue.TIMESTAMP });
      }
    });
  });
}

function loadChannels() {
  db.ref('channels').on('value', function(snapshot) {
    var list = document.getElementById('channel-list');
    list.innerHTML = '';
    var items = [];
    snapshot.forEach(function(child) {
      items.push({ key: child.key, val: child.val() });
    });
    items.sort(function(a, b) { return a.val.name.localeCompare(b.val.name); });
    items.forEach(function(item) {
      var ch = item.val;
      var div = document.createElement('div');
      div.className = 'sidebar-item' + (currentChannelId === item.key ? ' active' : '');
      var icon = channelIcons[ch.name] || '';
      div.innerHTML = icon + ' <span>' + ch.name + '</span>';
      div.dataset.channelId = item.key;
      div.addEventListener('click', function() { switchToChannel(item.key); });
      list.appendChild(div);

      (function(div, key) {
        var lastRead = parseInt(localStorage.getItem('lastRead_' + key)) || 0;
        if (lastRead === 0) return;
        db.ref('channels/' + key + '/messages').orderByChild('createdAt').startAt(lastRead + 1).once('value', function(msgSnapshot) {
          var count = msgSnapshot.numChildren();
          if (count > 0) {
            var badge = document.createElement('span');
            badge.className = 'unread-badge';
            badge.textContent = count > 99 ? '99+' : count;
            div.appendChild(badge);
          }
        });
      })(div, item.key);
    });
  });
}

function loadDMs() {
  var myUid = auth.currentUser.uid;
  db.ref('userDMs/' + myUid).on('value', function(snapshot) {
    var list = document.getElementById('dm-list');
    var version = ++dmListVersion;
    list.innerHTML = '';
    var dmIds = [];
    snapshot.forEach(function(child) {
      dmIds.push(child.key);
    });
    // Detach old status listeners
    document.querySelectorAll('#dm-list .status-dot[data-listener]').forEach(function(el) { el.removeAttribute('data-listener'); });
    var promises = [];
    snapshot.forEach(function(child) {
      var dmId = child.key;
      var otherId = dmId.split('_').filter(function(id) { return id !== myUid; })[0];
      if (!otherId) return;
      promises.push(
        db.ref('users/' + otherId).once('value').then(function(userSnapshot) {
          if (!userSnapshot.exists()) return null;
          var userData = userSnapshot.val();
          var div = document.createElement('div');
          div.className = 'sidebar-item' + (currentDmId === dmId ? ' active' : '');
          var initial = userData.displayName ? userData.displayName.charAt(0).toUpperCase() : '?';
          var colour = userData.avatarColour || '#2d5da1';
          div.innerHTML = '<div class="avatar-wrap" onclick="event.stopPropagation();showUserOptions(\'' + otherId + '\')" style="cursor:pointer;"><span class="avatar avatar-sm" style="width:28px;height:28px;font-size:0.8rem;background:' + colour + ';">' + initial + '</span><span class="status-dot offline" id="dot-' + otherId + '"></span></div><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;" onclick="switchToDM(\'' + dmId + '\',\'' + otherId + '\')">' + (userData.displayName || 'Unknown') + '</span>';
          div.dataset.dmId = dmId;

          // Status listener
          (function(uid) {
            db.ref('users/' + uid + '/status').on('value', function(snap) {
              var dot = document.getElementById('dot-' + uid);
              if (!dot) return;
              var s = snap.val();
              if (!s || !s.online) dot.className = 'status-dot offline';
              else if (s.focus) dot.className = 'status-dot online';
              else dot.className = 'status-dot away';
            });
          })(otherId);

          (function(div, key, otherName) {
            var del = document.createElement('button');
            del.className = 'dm-delete-btn';
            del.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12"/><path d="M5 4V2.5A.5.5 0 015.5 2h2a.5.5 0 01.5.5V4"/><path d="M12 4v9a1.5 1.5 0 01-1.5 1.5h-6A1.5 1.5 0 013 13V4"/></svg>';
            del.addEventListener('click', function(e) { e.stopPropagation(); deleteDM(key); });
            div.appendChild(del);
            // Real-time badge updates for future messages
            (function(k, n) {
              var lr = parseInt(localStorage.getItem('lastRead_' + k)) || 0;
              db.ref('dms/' + k + '/messages').orderByChild('createdAt').startAt(lr + 1).on('child_added', function(ms) {
                if (k === currentDmId) return;
                var m = ms.val();
                if (!m || m.senderId === auth.currentUser.uid) return;
                var existingBadge = div.querySelector('.unread-badge');
                if (existingBadge) {
                  var cnt = parseInt(existingBadge.textContent) + 1;
                  existingBadge.textContent = cnt > 99 ? '99+' : cnt;
                } else {
                  var badge = document.createElement('span');
                  badge.className = 'unread-badge';
                  badge.textContent = '1';
                  div.appendChild(badge);
                }
                if (!isWindowFocused) {
                  if (m.ciphertext) {
                    decryptMsgInPlace(m, 'dm_' + k).then(function() {
                      notifyMessage(m, n);
                    });
                  } else {
                    notifyMessage(m, n);
                  }
                }
              });
            })(key, otherName);
          })(div, dmId, userData.displayName || 'Unknown');

          return div;
        })
      );
    });
    Promise.all(promises).then(function(elements) {
      if (version !== dmListVersion) return;
      elements.forEach(function(el) { if (el) list.appendChild(el); });
    });
  });
}

function switchToChannel(channelId) {
  currentChannelId = channelId;
  currentDmId = null;
  currentGroupId = null;

  if (currentMsgQuery) { currentMsgQuery.off(); }

  localStorage.setItem('lastRead_' + channelId, Date.now());
  updateSidebarActive();
  var badgeEl = document.querySelector('#channel-list .sidebar-item[data-channel-id="' + channelId + '"] .unread-badge');
  if (badgeEl) badgeEl.remove();
  startTypingListener('channels/' + channelId);

  db.ref('channels/' + channelId).once('value').then(function(snapshot) {
    if (snapshot.exists()) {
      var icon = channelIcons[snapshot.val().name] || '';
      document.getElementById('current-channel-name').innerHTML = icon + ' ' + snapshot.val().name;
    }
  });

  var inputBar = document.getElementById('input-bar');
  var readonlyNotice = document.getElementById('readonly-notice');
  if (channelId === 'announcements' && currentUser.uid !== ADMIN_UID) {
    inputBar.style.display = 'none';
    readonlyNotice.style.display = 'flex';
  } else {
    inputBar.style.display = 'flex';
    readonlyNotice.style.display = 'none';
  }

  var msgRef = db.ref('channels/' + channelId + '/messages');
  currentMsgQuery = msgRef.orderByChild('createdAt').limitToLast(50);

  var messageList = document.getElementById('message-list');
  messageList.innerHTML = '<p class="text-center" style="padding:40px;color:rgba(45,45,45,0.4);">Loading messages...</p>';

  var channelConvPath = 'channel_' + channelId;
  var lastKnownTime = Date.now();
  currentMsgQuery.on('value', function(snapshot) {
    messageList.innerHTML = '';
    if (!snapshot.exists()) {
      messageList.innerHTML = '<p class="text-center" style="padding:40px;color:rgba(45,45,45,0.4);">No messages yet. Say something!</p>';
      return;
    }

    var newMsgs = [];
    var latestTime = lastKnownTime;
    var messages = [];
    snapshot.forEach(function(child) {
      var msg = child.val();
      msg._key = child.key;
      messages.push(msg);
      if (msg.createdAt && msg.createdAt > lastKnownTime) {
        newMsgs.push(msg);
      }
      if (msg.createdAt && msg.createdAt > latestTime) {
        latestTime = msg.createdAt;
      }
    });

    lastKnownTime = latestTime;

    // Decrypt all messages before rendering
    var decryptPromises = messages.map(function(msg) {
      return decryptMsgInPlace(msg, channelConvPath);
    });
    Promise.all(decryptPromises).then(function() {
      if (!isWindowFocused && newMsgs.length > 0) {
        newMsgs.forEach(function(msg) {
          if (msg.senderId !== currentUser.uid) {
            notifyMessage(msg, '#' + channelId);
          }
        });
      }

      messages.forEach(function(msg) {
        appendMessage(msg, messageList);
      });
      scrollToBottom();
    });
  });
}

function switchToDM(dmId, otherUserId) {
  currentDmId = dmId;
  currentChannelId = null;
  currentGroupId = null;

  if (currentMsgQuery) { currentMsgQuery.off(); }

  localStorage.setItem('lastRead_' + dmId, Date.now());
  updateSidebarActive();
  var badgeEl = document.querySelector('#dm-list .sidebar-item[data-dm-id="' + dmId + '"] .unread-badge');
  if (badgeEl) badgeEl.remove();
  startTypingListener('dms/' + dmId);

  db.ref('users/' + otherUserId).once('value').then(function(snapshot) {
    if (snapshot.exists()) {
      document.getElementById('current-channel-name').textContent = snapshot.val().displayName || 'Unknown';
    }
  });

  var inputBar = document.getElementById('input-bar');
  var readonlyNotice = document.getElementById('readonly-notice');
  inputBar.style.display = 'flex';
  readonlyNotice.style.display = 'none';

  var msgRef = db.ref('dms/' + dmId + '/messages');
  currentMsgQuery = msgRef.orderByChild('createdAt').limitToLast(50);

  var messageList = document.getElementById('message-list');
  messageList.innerHTML = '<p class="text-center" style="padding:40px;color:rgba(45,45,45,0.4);">Loading messages...</p>';

  var dmConvPath = 'dm_' + dmId;
  var lastKnownTime = Date.now();
  currentMsgQuery.on('value', function(snapshot) {
    messageList.innerHTML = '';
    if (!snapshot.exists()) {
      messageList.innerHTML = '<p class="text-center" style="padding:40px;color:rgba(45,45,45,0.4);">No messages yet. Say something!</p>';
      return;
    }

    var newMsgs = [];
    var latestTime = lastKnownTime;
    var messages = [];
    snapshot.forEach(function(child) {
      var msg = child.val();
      msg._key = child.key;
      messages.push(msg);
      if (msg.createdAt && msg.createdAt > lastKnownTime) {
        newMsgs.push(msg);
      }
      if (msg.createdAt && msg.createdAt > latestTime) {
        latestTime = msg.createdAt;
      }
    });

    lastKnownTime = latestTime;

    // Decrypt all messages before rendering
    var decryptPromises = messages.map(function(msg) {
      return decryptMsgInPlace(msg, dmConvPath);
    });
    Promise.all(decryptPromises).then(function() {
      if (!isWindowFocused && newMsgs.length > 0) {
        newMsgs.forEach(function(msg) {
          if (msg.senderId !== currentUser.uid) {
            notifyMessage(msg, msg.senderName);
          }
        });
      }

      messages.forEach(function(msg) {
        appendMessage(msg, messageList);
      });
      scrollToBottom();
    });
  });
}

function updateSidebarActive() {
  document.querySelectorAll('.sidebar-item').forEach(function(el) { el.classList.remove('active'); });
  if (currentGroupId) {
    document.querySelectorAll('#group-list .sidebar-item').forEach(function(el) {
      if (el.dataset.groupId === currentGroupId) el.classList.add('active');
    });
  } else if (currentDmId) {
    document.querySelectorAll('#dm-list .sidebar-item').forEach(function(el) {
      if (el.dataset.dmId === currentDmId) el.classList.add('active');
    });
  } else if (currentChannelId) {
    document.querySelectorAll('#channel-list .sidebar-item').forEach(function(el) {
      if (el.dataset.channelId === currentChannelId) el.classList.add('active');
    });
  }
}

function appendMessage(msg, container) {
  var isMine = msg.senderId === currentUser.uid;
  var row = document.createElement('div');
  row.className = 'message-row' + (isMine ? ' mine' : ' other');
  row.dataset.msgKey = msg._key || '';
  row.dataset.senderId = msg.senderId || '';
  row.dataset.senderName = msg.senderName || '';

  var content = document.createElement('div');
  content.className = 'msg-content';

  if (msg.text) {
    var bubble = document.createElement('div');
    bubble.className = isMine ? 'msg-bubble msg-bubble-mine' : 'msg-bubble msg-bubble-other';

    if (!isMine && (currentChannelId || currentGroupId)) {
      var name = document.createElement('div');
      name.className = 'msg-sender-name';
      name.textContent = msg.senderName;
      bubble.appendChild(name);
    }

    var textEl = document.createElement('span');
    textEl.textContent = msg.text;
    bubble.appendChild(textEl);
    content.appendChild(bubble);
  }

  if (msg.imageURL || msg.imageData) {
    if (!isMine && (currentChannelId || currentGroupId)) {
      var name = document.createElement('div');
      name.className = 'msg-sender-name';
      name.textContent = msg.senderName;
      content.appendChild(name);
    }
    var wrapper = document.createElement('div');
    wrapper.className = 'message-image tape';
    var img = document.createElement('img');
    img.src = msg.imageData || msg.imageURL;
    img.alt = 'Shared image';
    img.draggable = false;
    img.addEventListener('click', function() { openImageViewer(this.src); });
    wrapper.appendChild(img);
    content.appendChild(wrapper);
  }

  var actions = createMsgActions(msg, row);
  if (isMine) {
    row.appendChild(actions);
    row.appendChild(content);
  } else {
    row.appendChild(content);
    row.appendChild(actions);
  }
  container.appendChild(row);
}

function createMsgActions(msg, row) {
  var div = document.createElement('div');
  div.className = 'msg-actions';

  var editSvg = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z"/></svg>';
  var deleteSvg = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12"/><path d="M5 4V2.5A.5.5 0 015.5 2h5a.5.5 0 01.5.5V4"/><path d="M3 4l1 10h8l1-10"/></svg>';
  var replySvg = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l4-4M3 8l4 4"/><path d="M7 4h5a2 2 0 012 2v3"/></svg>';
  var copySvg = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="9" height="9" rx="1"/><path d="M2 10.5V3a1 1 0 011-1h7.5"/></svg>';

  if (msg.senderId === currentUser.uid) {
    if (msg.text) {
      var editBtn = document.createElement('button');
      editBtn.className = 'msg-action-btn';
      editBtn.innerHTML = editSvg;
      editBtn.title = 'Edit';
      editBtn.addEventListener('click', function(e) { e.stopPropagation(); editMessage(msg, row); });
      div.appendChild(editBtn);
    }
    var delBtn = document.createElement('button');
    delBtn.className = 'msg-action-btn';
    delBtn.innerHTML = deleteSvg;
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', function(e) { e.stopPropagation(); deleteMessage(msg); });
    div.appendChild(delBtn);
  } else {
    var replyBtn = document.createElement('button');
    replyBtn.className = 'msg-action-btn';
    replyBtn.innerHTML = replySvg;
    replyBtn.title = 'Reply';
    replyBtn.addEventListener('click', function(e) { e.stopPropagation(); replyToMessage(msg); });
    div.appendChild(replyBtn);
    var copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.innerHTML = copySvg;
    copyBtn.title = 'Copy';
    copyBtn.addEventListener('click', function(e) { e.stopPropagation(); copyMessage(msg, false); });
    div.appendChild(copyBtn);
    return div;
  }

  var replyBtn = document.createElement('button');
  replyBtn.className = 'msg-action-btn';
  replyBtn.innerHTML = replySvg;
  replyBtn.title = 'Reply';
  replyBtn.addEventListener('click', function(e) { e.stopPropagation(); replyToMessage(msg); });
  div.appendChild(replyBtn);

  var copyBtn = document.createElement('button');
  copyBtn.className = 'msg-action-btn';
  copyBtn.innerHTML = copySvg;
  copyBtn.title = 'Copy';
  copyBtn.addEventListener('click', function(e) { e.stopPropagation(); copyMessage(msg, true); });
  div.appendChild(copyBtn);

  return div;
}

function editMessage(msg, row) {
  var bubble = row.querySelector('.msg-bubble');
  if (!bubble) return;
  var oldText = msg.text || '';
  bubble.innerHTML = '';
  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.value = oldText;
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';
  bubble.appendChild(input);
  input.focus();
  input.select();

  function saveEdit() {
    var newText = input.value.trim();
    if (!newText || newText === oldText) { cancelEdit(); return; }
    var path = getMsgPath(msg._key);
    if (!path) { cancelEdit(); return; }
    getConvPathAsync().then(function(convPath) {
      encryptMessage(newText, convPath).then(function(encrypted) {
        var updates = {};
        updates.text = null;
        updates.imageURL = null;
        updates.imageData = null;
        updates.ciphertext = encrypted.ciphertext;
        updates.iv = encrypted.iv;
        updates.editedAt = firebase.database.ServerValue.TIMESTAMP;
        db.ref(path).update(updates);
      });
    });
  }

  function cancelEdit() {
    bubble.innerHTML = '';
    var span = document.createElement('span');
    span.textContent = oldText;
    bubble.appendChild(span);
  }

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') cancelEdit();
  });
  input.addEventListener('blur', function() {
    setTimeout(function() { if (!bubble.contains(document.activeElement)) cancelEdit(); }, 200);
  });
}

function deleteMessage(msg) {
  _deleteMsgKey = msg._key;
  document.getElementById('delete-message-modal').style.display = 'flex';
}

var _deleteMsgKey = null;

function confirmDeleteMessage() {
  var key = _deleteMsgKey;
  _deleteMsgKey = null;
  document.getElementById('delete-message-modal').style.display = 'none';
  if (!key) return;
  var path = getMsgPath(key);
  if (!path) return;
  db.ref(path).remove();
}

function replyToMessage(msg) {
  var input = document.getElementById('message-input');
  if (!input) return;
  var prefix = '@' + (msg.senderName || 'Unknown') + ': ' + (msg.text || '');
  input.value = prefix + (input.value ? ' ' + input.value : '');
  input.focus();
}

function copyMessage(msg, isOwn) {
  var text;
  if (isOwn) {
    text = msg.text || '';
  } else {
    text = (msg.senderName || 'Unknown') + ': ' + (msg.text || '');
  }
  if (!text) {
    showToast('Nothing to copy');
    return;
  }
  navigator.clipboard.writeText(text).then(function() {
    showToast('Copied');
  }).catch(function() {
    showToast('Failed to copy');
  });
}

function getMsgPath(msgKey) {
  if (currentChannelId) return 'channels/' + currentChannelId + '/messages/' + msgKey;
  if (currentDmId) return 'dms/' + currentDmId + '/messages/' + msgKey;
  if (currentGroupId) return 'groups/' + currentGroupId + '/messages/' + msgKey;
  return null;
}

function getConvPathAsync() {
  return Promise.resolve(getConvPath());
}

function getConvPath() {
  if (currentChannelId) return 'channel_' + currentChannelId;
  if (currentDmId) return 'dm_' + currentDmId;
  if (currentGroupId) return 'group_' + currentGroupId;
  return null;
}

function decryptMsgInPlace(msg, convPath) {
  if (!msg.ciphertext || msg._decrypted) return Promise.resolve();
  msg._decrypted = true;
  return decryptMessage(msg.ciphertext, msg.iv, convPath).then(function(plaintext) {
    if (plaintext.indexOf('data:image/') === 0) {
      msg.imageData = plaintext;
    } else {
      msg.text = plaintext;
    }
  }).catch(function() {
    msg.text = '[Failed to decrypt]';
  });
}

function sendMessage() {
  var input = document.getElementById('message-input');
  var text = input.value.trim();
  if (!text || (!currentChannelId && !currentDmId && !currentGroupId)) return;

  if (currentChannelId === 'announcements' && currentUser.uid !== ADMIN_UID) {
    showToast("Only Scribble (Official) can post here.");
    input.value = '';
    return;
  }

  var convPath = getConvPath();
  encryptMessage(text, convPath).then(function(encrypted) {
    var msg = {
      senderId: currentUser.uid,
      senderName: currentUser.displayName,
      text: null,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    };

    if (currentChannelId) {
      db.ref('channels/' + currentChannelId + '/messages').push(msg);
    } else if (currentDmId) {
      db.ref('dms/' + currentDmId + '/messages').push(msg);
    } else if (currentGroupId) {
      db.ref('groups/' + currentGroupId + '/messages').push(msg);
    }
  });

  input.value = '';
  var uid = auth.currentUser.uid;
  var typingPath = currentChannelId ? 'channels/' + currentChannelId + '/typing/' + uid
                 : currentDmId ? 'dms/' + currentDmId + '/typing/' + uid
                 : 'groups/' + currentGroupId + '/typing/' + uid;
  db.ref(typingPath).remove();
  input.focus();
}

function handleImageUpload(event) {
  var file = event.target.files[0];
  if (!file || (!currentChannelId && !currentDmId && !currentGroupId)) return;

  if (currentChannelId === 'announcements' && currentUser.uid !== ADMIN_UID) {
    showToast("Only Scribble (Official) can post here.");
    event.target.value = '';
    return;
  }

  var convPath = getConvPath();
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var maxW = 1200;
      var scale = Math.min(1, maxW / img.width, maxW / img.height);
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      var compressed = canvas.toDataURL('image/jpeg', 0.75);

      encryptMessage(compressed, convPath).then(function(encrypted) {
        var msg = {
          senderId: currentUser.uid,
          senderName: currentUser.displayName,
          text: null,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          createdAt: firebase.database.ServerValue.TIMESTAMP
        };

        if (currentChannelId) {
          db.ref('channels/' + currentChannelId + '/messages').push(msg);
        } else if (currentDmId) {
          db.ref('dms/' + currentDmId + '/messages').push(msg);
        } else if (currentGroupId) {
          db.ref('groups/' + currentGroupId + '/messages').push(msg);
        }
      });
    };
    img.src = e.target.result;
  };
  reader.onerror = function() {
    showToast('Failed to read image.');
  };
  reader.readAsDataURL(file);

  event.target.value = '';
}

var _notifGranted = null;
function ensureNotifPermission() {
  if (_notifGranted !== null) return Promise.resolve(_notifGranted);
  return window.__TAURI__.core.invoke('plugin:notification|is_permission_granted').then(function(granted) {
    if (granted) { _notifGranted = true; return true; }
    return window.__TAURI__.core.invoke('plugin:notification|request_permission').then(function(result) {
      _notifGranted = (result === 'granted');
      console.log('Notification permission requested, result:', result);
      return _notifGranted;
    });
  }).catch(function(e) {
    console.error('Permission check failed:', e);
    return false;
  });
}

function notifyMessage(msg, source) {
  if (!window.__TAURI__) return;
  ensureNotifPermission().then(function(granted) {
    if (!granted) { console.log('Notif skipped: permission not granted'); return; }
    var title = "Scribble - " + source;
    var body = (msg.senderName || "Someone") + ": " + (msg.text || (msg.imageData ? "Image" : (msg.ciphertext ? "Encrypted message" : "Image")));
    console.log('Sending notification:', title, body);
    window.__TAURI__.core.invoke('notify', { title: title, body: body }).catch(function(e) {
      console.error('Notification failed:', e);
    });
  });
}

function showToast(text) {
  var toast = document.getElementById('toast');
  if (!toast) return;
  clearTimeout(toast._timeout);
  toast.textContent = text;
  toast.style.display = 'block';
  toast.style.opacity = '1';
  toast._timeout = setTimeout(function() {
    toast.style.opacity = '0';
    setTimeout(function() { toast.style.display = 'none'; }, 300);
  }, 2500);
}

function scrollToBottom() {
  var messageList = document.getElementById('message-list');
  setTimeout(function() {
    messageList.scrollTop = messageList.scrollHeight;
  }, 100);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

function toggleDMList() {
  var list = document.getElementById('dm-list');
  var arrow = document.getElementById('dm-collapse-arrow');
  var collapsed = list.style.display === 'none';
  list.style.display = collapsed ? 'block' : 'none';
  if (arrow) arrow.classList.toggle('collapsed', !collapsed);
  localStorage.setItem('dmCollapsed', collapsed ? '0' : '1');
}

function logoutFromSidebar() {
  auth.signOut().then(function() {
    window.location.href = 'signin.html';
  });
}

function showNewDMModal() {
  document.getElementById('new-dm-modal').style.display = 'flex';
  loadAllUsers();
}

function hideNewDMModal() {
  document.getElementById('new-dm-modal').style.display = 'none';
}

function loadAllUsers() {
  var myUid = auth.currentUser.uid;
  var profileCard = document.getElementById('profile-card');
  profileCard.innerHTML = '<p style="color:rgba(45,45,45,0.4);font-size:0.9rem;margin-top:60px;">Select a user to view their profile</p>';
  selectedProfileUid = null;

  Promise.all([
    db.ref('users').once('value'),
    db.ref('friendRequests').once('value'),
    db.ref('users/' + myUid + '/blocked').once('value')
  ]).then(function(results) {
    var usersSnapshot = results[0];
    var reqSnapshot = results[1];
    var blockedSnap = results[2];
    var blockedMap = blockedSnap.val() || {};
    var resultsList = document.getElementById('user-search-results');
    resultsList.innerHTML = '';

    var relMap = {};
    reqSnapshot.forEach(function(child) {
      var req = child.val();
      if (req.from === myUid) {
        relMap[req.to] = req.status;
      }
      if (req.to === myUid) {
        relMap[req.from] = req.status === 'pending' ? 'request' : req.status;
      }
    });

    usersSnapshot.forEach(function(child) {
      if (child.key === myUid) return;
      var userData = child.val();
      var div = document.createElement('div');
      div.className = 'sidebar-item';
      div.dataset.uid = child.key;

      var initial = userData.displayName ? userData.displayName.charAt(0).toUpperCase() : '?';
      var colour = userData.avatarColour || '#2d5da1';
      div.innerHTML = '<div class="avatar-wrap"><span class="avatar avatar-sm" style="width:28px;height:28px;font-size:0.8rem;background:' + colour + ';">' + initial + '</span><span class="status-dot offline" id="sdot-' + child.key + '"></span></div><span>' + (userData.displayName || 'Unknown') + '</span>';
      (function(uid) {
        div.addEventListener('click', function() { showUserProfile(uid); });
        db.ref('users/' + uid + '/status').on('value', function(snap) {
          var dot = document.getElementById('sdot-' + uid);
          if (!dot) return;
          var s = snap.val();
          if (!s || !s.online) dot.className = 'status-dot offline';
          else if (s.focus) dot.className = 'status-dot online';
          else dot.className = 'status-dot away';
        });
      })(child.key);
      resultsList.appendChild(div);
    });
  });
}

function searchUsers(query) {
  document.querySelectorAll('#user-search-results .sidebar-item').forEach(function(item) {
    var text = item.textContent.toLowerCase();
    item.style.display = text.indexOf(query.toLowerCase()) !== -1 ? 'flex' : 'none';
  });
}

function startDM(otherUserId) {
  var myUid = auth.currentUser.uid;

  if (otherUserId === ADMIN_UID) {
    createAndOpenDM(otherUserId);
    return;
  }

  Promise.all([
    db.ref('friendRequests/' + myUid + '_' + otherUserId).once('value'),
    db.ref('friendRequests/' + otherUserId + '_' + myUid).once('value')
  ]).then(function(results) {
    var myReq = results[0].val();
    var theirReq = results[1].val();

    if ((myReq && myReq.status === 'accepted') || (theirReq && theirReq.status === 'accepted')) {
      createAndOpenDM(otherUserId);
    } else {
      showToast('You must be friends to start a conversation.');
    }
  });
}

function createAndOpenDM(otherUserId) {
  var ids = [auth.currentUser.uid, otherUserId].sort();
  var dmId = ids.join('_');
  var myUid = auth.currentUser.uid;
  var participants = {};
  participants[ids[0]] = true;
  participants[ids[1]] = true;

  var updates = {};
  updates['dms/' + dmId] = { participants: participants };
  updates['userDMs/' + myUid + '/' + dmId] = true;
  updates['userDMs/' + otherUserId + '/' + dmId] = true;

  db.ref().update(updates).then(function() {
    hideNewDMModal();
    switchToDM(dmId, otherUserId);
  });
}

function showUserProfile(uid) {
  selectedProfileUid = uid;

  document.querySelectorAll('#user-search-results .sidebar-item').forEach(function(el) {
    el.classList.toggle('active', el.dataset.uid === uid);
  });

  var profileCard = document.getElementById('profile-card');
  profileCard.innerHTML = '<p style="color:rgba(45,45,45,0.4);font-size:0.9rem;">Loading profile...</p>';

  var myUid = auth.currentUser.uid;
  Promise.all([
    db.ref('users/' + uid).once('value'),
    db.ref('friendRequests').once('value'),
    db.ref('users/' + myUid + '/blocked/' + uid).once('value'),
    db.ref('users/' + uid + '/blocked/' + myUid).once('value')
  ]).then(function(results) {
    var userSnapshot = results[0];
    if (!userSnapshot.exists()) return;
    var userData = userSnapshot.val();
    var reqSnapshot = results[1];
    var iBlockedThem = results[2].val();
    var theyBlockedMe = results[3].val();

    var requestId_me = myUid + '_' + uid;
    var requestId_them = uid + '_' + myUid;
    var myRequest = null;
    var theirRequest = null;

    reqSnapshot.forEach(function(child) {
      if (child.key === requestId_me) myRequest = child.val();
      if (child.key === requestId_them) theirRequest = child.val();
    });

    var initial = userData.displayName ? userData.displayName.charAt(0).toUpperCase() : '?';
    var followerCount = userData.followers ? Object.keys(userData.followers).length : 0;
    var followingCount = userData.following ? Object.keys(userData.following).length : 0;
    var avatarColour = userData.avatarColour || '#2d5da1';

    var joinDate = '';
    if (userData.createdAt) {
      var d = new Date(userData.createdAt);
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      joinDate = months[d.getMonth()] + ' ' + d.getFullYear();
    }

    var actionsHtml = '';

    if (iBlockedThem) {
      actionsHtml = '<p style="font-size:0.85rem;color:rgba(45,45,45,0.5);margin-bottom:8px;">You have blocked this user.</p><button class="btn friend-btn" onclick="unblockUser(\'' + uid + '\')">Unblock</button>';
    } else if (theyBlockedMe) {
      actionsHtml = '<p style="font-size:0.85rem;color:rgba(45,45,45,0.5);margin-bottom:8px;">This user has blocked you.</p>';
    } else if (myRequest && myRequest.status === 'pending') {
      var lastBump = myRequest.lastBump || 0;
      var cooldown = 3600000 - (Date.now() - lastBump);
      if (cooldown > 0) {
        var min = Math.ceil(cooldown / 60000);
        actionsHtml = '<button class="btn friend-btn" disabled>Pending (' + min + 'm)</button>';
      } else {
        actionsHtml = '<button class="btn friend-btn" onclick="bumpFriendRequest(\'' + uid + '\')">Bump Request</button>';
      }
      actionsHtml += '<button class="btn btn-secondary friend-btn" onclick="blockUser(\'' + uid + '\')">Block</button>';
    } else if (theirRequest && theirRequest.status === 'pending') {
      actionsHtml = '<button class="btn friend-btn" style="background:var(--color-secondary);color:#fff;" onclick="acceptFriendRequest(\'' + uid + '\')">Accept Request</button><button class="btn btn-secondary friend-btn" onclick="declineFriendRequest(\'' + uid + '\')">Decline</button>';
      actionsHtml += '<button class="btn btn-secondary friend-btn" onclick="blockUser(\'' + uid + '\')">Block</button>';
    } else if ((myRequest && myRequest.status === 'accepted') || (theirRequest && theirRequest.status === 'accepted')) {
      actionsHtml = '<button class="btn friend-btn" style="background:var(--color-secondary);color:#fff;" onclick="startDM(\'' + uid + '\')">Message</button>';
      actionsHtml += '<button class="btn btn-secondary friend-btn" onclick="unfriend(\'' + uid + '\')">Unfriend</button>';
      actionsHtml += '<button class="btn btn-secondary friend-btn" onclick="blockUser(\'' + uid + '\')">Block</button>';
    } else {
      actionsHtml = '<button class="btn friend-btn" onclick="sendFriendRequest(\'' + uid + '\')">Send Friend Request</button>';
      actionsHtml += '<button class="btn btn-secondary friend-btn" onclick="blockUser(\'' + uid + '\')">Block</button>';
    }

    actionsHtml += '<button class="btn btn-secondary friend-btn" onclick="shareProfile(\'' + uid + '\')">Share Profile</button>';

    var msgCountHtml = '<div class="profile-stats"><div class="stat"><div class="num" id="pcard-msgs">...</div><div class="label">messages</div></div><div class="stat"><div class="num">' + followingCount + '</div><div class="label">following</div></div><div class="stat"><div class="num">' + followerCount + '</div><div class="label">followers</div></div></div>';

    profileCard.innerHTML =
      '<div class="avatar avatar-lg avatar-fallback" style="background:' + avatarColour + ';width:64px;height:64px;font-size:1.8rem;margin-bottom:8px;">' + initial + '</div>' +
      '<h3>' + (userData.displayName || 'Unknown') + '</h3>' +
      '<p class="profile-email">' + (userData.email || '') + '</p>' +
      msgCountHtml +
      actionsHtml;

    db.ref('channels').once('value').then(function(chSnapshot) {
      var total = 0;
      var promises = [];
      chSnapshot.forEach(function(ch) {
        promises.push(db.ref('channels/' + ch.key + '/messages').once('value').then(function(msgSnapshot) {
          msgSnapshot.forEach(function(msgChild) {
            if (msgChild.val().senderId === uid) total++;
          });
        }));
      });
      Promise.all(promises).then(function() {
        var el = document.getElementById('pcard-msgs');
        if (el) el.textContent = total;
      });
    });
  });
}

function sendFriendRequest(toUid) {
  var myUid = auth.currentUser.uid;

  db.ref('users/' + myUid + '/blocked/' + toUid).once('value').then(function(blockedSnap) {
    if (blockedSnap.val()) { showToast('You have blocked this user.'); return; }
    db.ref('users/' + toUid + '/blocked/' + myUid).once('value').then(function(blockedBySnap) {
      if (blockedBySnap.val()) { showToast('This user has blocked you.'); return; }

      var requestId = myUid + '_' + toUid;
      var updates = {};
      updates['friendRequests/' + requestId] = {
        from: myUid,
        to: toUid,
        status: 'pending',
        lastBump: 0,
        createdAt: firebase.database.ServerValue.TIMESTAMP
      };
      updates['users/' + myUid + '/following/' + toUid] = true;
      updates['users/' + toUid + '/followers/' + myUid] = true;

      db.ref().update(updates).then(function() {
        showToast('Friend request sent!');
        showUserProfile(toUid);
        loadAllUsers();
      });
    });
  });
}

function acceptFriendRequest(fromUid) {
  var myUid = auth.currentUser.uid;
  var requestId = fromUid + '_' + myUid;

  var ids = [myUid, fromUid].sort();
  var dmId = ids.join('_');
  var participants = {};
  participants[ids[0]] = true;
  participants[ids[1]] = true;

  var updates = {};
  updates['friendRequests/' + requestId + '/status'] = 'accepted';
  updates['dms/' + dmId] = { participants: participants };
  updates['userDMs/' + myUid + '/' + dmId] = true;
  updates['userDMs/' + fromUid + '/' + dmId] = true;

  db.ref().update(updates).then(function() {
    showToast('Friend request accepted!');
    hideNewDMModal();
    switchToDM(dmId, fromUid);
  });
}

function declineFriendRequest(fromUid) {
  var myUid = auth.currentUser.uid;
  var requestId = fromUid + '_' + myUid;

  db.ref('friendRequests/' + requestId).remove().then(function() {
    showToast('Request declined.');
    showUserProfile(fromUid);
    loadAllUsers();
  });
}

function bumpFriendRequest(toUid) {
  var myUid = auth.currentUser.uid;
  var requestId = myUid + '_' + toUid;

  db.ref('friendRequests/' + requestId + '/lastBump').set(Date.now()).then(function() {
    showToast('Reminder sent!');
    showUserProfile(toUid);
  });
}

function unfriend(uid) {
  var myUid = auth.currentUser.uid;
  var ids = [myUid, uid].sort();
  var dmId = ids.join('_');

  var updates = {};
  updates['users/' + myUid + '/following/' + uid] = null;
  updates['users/' + uid + '/followers/' + myUid] = null;
  updates['friendRequests/' + myUid + '_' + uid] = null;
  updates['friendRequests/' + uid + '_' + myUid] = null;
  updates['dms/' + dmId] = null;
  updates['userDMs/' + myUid + '/' + dmId] = null;
  updates['userDMs/' + uid + '/' + dmId] = null;

  db.ref().update(updates).then(function() {
    showToast('Unfriended.');
    if (currentDmId === dmId) {
      currentDmId = null;
      switchToChannel('general');
    }
    showUserProfile(uid);
    loadAllUsers();
  });
}

function blockUser(uid) {
  var myUid = auth.currentUser.uid;
  var updates = {};
  updates['users/' + myUid + '/blocked/' + uid] = true;
  // Also remove friend relationship if exists
  var ids = [myUid, uid].sort();
  var dmId = ids.join('_');
  updates['users/' + myUid + '/following/' + uid] = null;
  updates['users/' + uid + '/followers/' + myUid] = null;
  updates['friendRequests/' + myUid + '_' + uid] = null;
  updates['friendRequests/' + uid + '_' + myUid] = null;
  updates['dms/' + dmId] = null;
  updates['userDMs/' + myUid + '/' + dmId] = null;
  updates['userDMs/' + uid + '/' + dmId] = null;

  db.ref().update(updates).then(function() {
    showToast('User blocked.');
    if (currentDmId === dmId) {
      currentDmId = null;
      switchToChannel('general');
    }
    showUserProfile(uid);
    loadAllUsers();
  });
}

function unblockUser(uid) {
  var myUid = auth.currentUser.uid;
  db.ref('users/' + myUid + '/blocked/' + uid).remove().then(function() {
    showToast('User unblocked.');
    showUserProfile(uid);
    loadAllUsers();
  });
}

function shareProfile(uid) {
  navigator.clipboard.writeText('Scribble profile: ' + window.location.origin + '/?user=' + uid).then(function() {
    showToast('Profile link copied!');
  }).catch(function() {
    showToast('Profile: ' + uid);
  });
}

// ===== USER OPTIONS =====

var _userOptionsUid = null;

function showUserOptions(uid) {
  _userOptionsUid = uid;
  var myUid = auth.currentUser.uid;
  var header = document.getElementById('user-options-header');
  var buttons = document.getElementById('user-options-buttons');

  Promise.all([
    db.ref('users/' + uid).once('value'),
    db.ref('friendRequests/' + myUid + '_' + uid).once('value'),
    db.ref('friendRequests/' + uid + '_' + myUid).once('value'),
    db.ref('users/' + myUid + '/blocked/' + uid).once('value')
  ]).then(function(results) {
    var userSnap = results[0];
    if (!userSnap.exists()) { showToast('User not found.'); return; }
    var userData = userSnap.val();
    var myReq = results[1].val();
    var theirReq = results[2].val();
    var blocked = results[3].val();

    var initial = (userData.displayName || '?').charAt(0).toUpperCase();
    var colour = userData.avatarColour || '#2d5da1';

    header.innerHTML = '<div class="uoptions-avatar" style="background:' + colour + ';">' + initial + '</div><div class="uoptions-name">' + (userData.displayName || 'Unknown') + '</div>';

    var html = '';
    var isFriend = (myReq && myReq.status === 'accepted') || (theirReq && theirReq.status === 'accepted');

    // Message button
    html += '<button class="btn uoptions-btn" onclick="startDMFromOptions()"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2.5h12A1.5 1.5 0 0115.5 4v7a1.5 1.5 0 01-1.5 1.5H4l-2.5 2V4A1.5 1.5 0 012 2.5z"/></svg> Message</button>';

    if (isFriend) {
      html += '<button class="btn btn-secondary uoptions-btn" onclick="unfriendFromOptions()"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a2 2 0 100-4 2 2 0 000 4z"/><path d="M2 14v-1a3 3 0 013-3h2a3 3 0 013 3v1"/><path d="M10 8.5L12.5 11M12.5 8.5L10 11"/></svg> Unfriend</button>';
    }

    if (blocked) {
      html += '<button class="btn btn-secondary uoptions-btn" onclick="unblockFromOptions()"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M4.5 4.5l7 7"/><path d="M11.5 4.5l-7 7"/></svg> Unblock</button>';
    } else {
      html += '<button class="btn btn-secondary uoptions-btn" onclick="blockFromOptions()"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M4.5 4.5l7 7"/></svg> Block</button>';
    }

    // Create group with this person
    html += '<button class="btn btn-secondary uoptions-btn" onclick="createGroupFromOptions()"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a2 2 0 100-4 2 2 0 000 4z"/><path d="M2 14v-1a3 3 0 013-3h2a3 3 0 013 3v1"/><path d="M10 7h4M12 5v4"/></svg> Create Group</button>';

    // Add to group
    html += '<button class="btn btn-secondary uoptions-btn" onclick="toggleAddToGroupList()"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a2 2 0 100-4 2 2 0 000 4z"/><path d="M2 14v-1a3 3 0 013-3h2a3 3 0 013 3v1"/><path d="M10 6h4M12 4v4"/></svg> Add to Group <span style="margin-left:auto;">▸</span></button>';
    html += '<div class="uoptions-group-list" id="uoptions-group-list"><p id="uoptions-groups-placeholder">Loading...</p></div>';

    buttons.innerHTML = html;
    _groupListLoaded = false;
    document.getElementById('user-options-modal').style.display = 'flex';
  });
}

function hideUserOptions() {
  document.getElementById('user-options-modal').style.display = 'none';
  _userOptionsUid = null;
}

function startDMFromOptions() {
  var uid = _userOptionsUid;
  if (!uid) return;
  var myUid = auth.currentUser.uid;
  var ids = [myUid, uid].sort();
  var dmId = ids.join('_');
  hideUserOptions();
  switchToDM(dmId, uid);
}

function unfriendFromOptions() {
  var uid = _userOptionsUid;
  if (!uid) return;
  hideUserOptions();
  unfriend(uid);
}

function blockFromOptions() {
  var uid = _userOptionsUid;
  if (!uid) return;
  hideUserOptions();
  blockUser(uid);
}

function unblockFromOptions() {
  var uid = _userOptionsUid;
  if (!uid) return;
  hideUserOptions();
  unblockUser(uid);
}

function createGroupFromOptions() {
  var uid = _userOptionsUid;
  if (!uid) return;
  hideUserOptions();
  var name = prompt('Enter a group name:');
  if (!name || !name.trim()) return;
  name = name.trim();

  var code = generateJoinCode();
  var myUid = auth.currentUser.uid;
  var groupData = {
    name: name,
    createdBy: myUid,
    joinCode: code,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    members: {}
  };
  groupData.members[myUid] = true;
  groupData.members[uid] = true;

  db.ref('groups').push(groupData).then(function() {
    showToast('Group "' + name + '" created! Code: ' + code);
  });
}

var _groupListLoaded = false;

function toggleAddToGroupList() {
  var list = document.getElementById('uoptions-group-list');
  var uid = _userOptionsUid;
  if (!uid) return;
  if (list.classList.contains('open')) {
    list.classList.remove('open');
    return;
  }
  list.classList.add('open');
  if (_groupListLoaded) return;
  _groupListLoaded = true;

  var myUid = auth.currentUser.uid;
  list.innerHTML = '<p id="uoptions-groups-placeholder">Loading...</p>';

  db.ref('groups').orderByChild('createdBy').equalTo(myUid).once('value').then(function(snap) {
    var groups = [];
    snap.forEach(function(child) {
      groups.push({ id: child.key, name: child.val().name });
    });
    if (groups.length === 0) {
      list.innerHTML = '<p id="uoptions-groups-placeholder">You haven\'t created any groups.</p>';
      return;
    }
    var html = '';
    groups.forEach(function(g) {
      html += '<div class="uoptions-group-item" onclick="addUserToGroup(\'' + uid + '\',\'' + g.id + '\')">' + g.name + '</div>';
    });
    list.innerHTML = html;
  });
}

function addUserToGroup(uid, groupId) {
  db.ref('groups/' + groupId + '/members/' + uid).set(true).then(function() {
    db.ref('groups/' + groupId + '/name').once('value').then(function(snap) {
      hideUserOptions();
      showToast('Added to "' + (snap.val() || 'group') + '"');
    });
  });
}

function deleteDM(dmId) {
  var modal = document.getElementById('delete-dm-modal');
  var confirmBtn = document.getElementById('confirm-delete-dm-btn');
  var newBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
  newBtn.addEventListener('click', function() {
    modal.style.display = 'none';
    db.ref('dms/' + dmId + '/participants').once('value').then(function(psnap) {
      var participants = psnap.val();
      var updates = {};
      updates['dms/' + dmId] = null;
      if (participants) {
        Object.keys(participants).forEach(function(uid) {
          updates['userDMs/' + uid + '/' + dmId] = null;
        });
      }
      return db.ref().update(updates);
    }).then(function() {
      if (currentDmId === dmId) {
        currentDmId = null;
        switchToChannel('general');
      }
    });
  });
  modal.style.display = 'flex';
}

// ===== GROUPS =====

var groupIcon = '<svg viewBox="0 0 16 16" width="16" height="16" style="vertical-align:middle;" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7a2 2 0 100-4 2 2 0 000 4z"/><path d="M1 14v-1a3 3 0 013-3h2a3 3 0 013 3v1"/><path d="M11 4a2 2 0 100 4 2 2 0 000-4z"/><path d="M15 14v-1a3 3 0 00-3-3h-1"/></svg>';

function loadGroups() {
  var myUid = auth.currentUser.uid;
  db.ref('groups').orderByChild('members/' + myUid).equalTo(true).on('value', function(snapshot) {
    var list = document.getElementById('group-list');
    list.innerHTML = '';
    snapshot.forEach(function(child) {
      var grp = child.val();
      if (!grp.members || !grp.members[myUid]) return;
      var div = document.createElement('div');
      div.className = 'sidebar-item' + (currentGroupId === child.key ? ' active' : '');
      div.innerHTML = groupIcon + ' <span>' + grp.name + '</span>';
      div.dataset.groupId = child.key;
      div.addEventListener('click', function() { switchToGroup(child.key); });

      var delBtn = document.createElement('button');
      delBtn.className = 'dm-delete-btn';
      delBtn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12"/><path d="M5 4V2.5A.5.5 0 015.5 2h2a.5.5 0 01.5.5V4"/><path d="M12 4v9a1.5 1.5 0 01-1.5 1.5h-6A1.5 1.5 0 013 13V4"/></svg>';
      delBtn.title = grp.creator === myUid ? 'Delete Group' : 'Leave Group';
      delBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        showDeleteGroupModal(child.key, grp.creator === myUid);
      });
      div.appendChild(delBtn);

      list.appendChild(div);
    });
  });
}

function setupNotificationListeners() {
  var uid = auth.currentUser.uid;
  var attachedChannels = {};
  var attachedGroups = {};

  db.ref('channels').on('value', function(snapshot) {
    snapshot.forEach(function(child) {
      var channelId = child.key;
      if (attachedChannels[channelId]) return;
      attachedChannels[channelId] = true;
      var channelName = child.val().name;
      var lastRead = parseInt(localStorage.getItem('lastRead_' + channelId)) || 0;
      var startTime = lastRead > 0 ? lastRead + 1 : Date.now();
      db.ref('channels/' + channelId + '/messages').orderByChild('createdAt').startAt(startTime).on('child_added', function(msgSnap) {
        if (channelId === currentChannelId) return;
        var msg = msgSnap.val();
        if (!msg || msg.senderId === uid) return;
        if (!isWindowFocused) {
          if (msg.ciphertext) {
            decryptMsgInPlace(msg, 'channel_' + channelId).then(function() {
              notifyMessage(msg, '# ' + channelName);
            });
          } else {
            notifyMessage(msg, '# ' + channelName);
          }
        }
      });
    });
  });

  db.ref('groups').orderByChild('members/' + uid).equalTo(true).on('value', function(snapshot) {
    snapshot.forEach(function(child) {
      var groupId = child.key;
      if (attachedGroups[groupId]) return;
      attachedGroups[groupId] = true;
      var groupName = child.val().name;
      var lastRead = parseInt(localStorage.getItem('lastRead_' + groupId)) || 0;
      var startTime = lastRead > 0 ? lastRead + 1 : Date.now();
      db.ref('groups/' + groupId + '/messages').orderByChild('createdAt').startAt(startTime).on('child_added', function(msgSnap) {
        if (groupId === currentGroupId) return;
        var msg = msgSnap.val();
        if (!msg || msg.senderId === uid) return;
        if (!isWindowFocused) {
          if (msg.ciphertext) {
            decryptMsgInPlace(msg, 'group_' + groupId).then(function() {
              notifyMessage(msg, groupName);
            });
          } else {
            notifyMessage(msg, groupName);
          }
        }
      });
    });
  });
}

function switchToGroup(groupId) {
  currentGroupId = groupId;
  currentChannelId = null;
  currentDmId = null;

  if (currentMsgQuery) { currentMsgQuery.off(); }

  localStorage.setItem('lastRead_' + groupId, Date.now());
  updateSidebarActive();
  var badgeEl = document.querySelector('#group-list .sidebar-item[data-group-id="' + groupId + '"] .unread-badge');
  if (badgeEl) badgeEl.remove();
  startTypingListener('groups/' + groupId);

  var groupConvPath = 'group_' + groupId;
  var groupName = 'Group';
  db.ref('groups/' + groupId).once('value').then(function(snapshot) {
    if (snapshot.exists()) {
      var data = snapshot.val();
      groupName = data.name || 'Group';
      var code = data.joinCode;
      document.getElementById('current-channel-name').innerHTML = groupIcon + ' ' + groupName + (code ? ' <span style="font-size:0.8rem;opacity:0.6;margin-left:8px;">Code: ' + code + '</span>' : '');
    }
  });

  var inputBar = document.getElementById('input-bar');
  var readonlyNotice = document.getElementById('readonly-notice');
  inputBar.style.display = 'flex';
  readonlyNotice.style.display = 'none';

  var msgRef = db.ref('groups/' + groupId + '/messages');
  currentMsgQuery = msgRef.orderByChild('createdAt').limitToLast(50);

  var messageList = document.getElementById('message-list');
  messageList.innerHTML = '<p class="text-center" style="padding:40px;color:rgba(45,45,45,0.4);">Loading messages...</p>';

  var lastKnownTime = Date.now();
  currentMsgQuery.on('value', function(snapshot) {
    messageList.innerHTML = '';
    if (!snapshot.exists()) {
      messageList.innerHTML = '<p class="text-center" style="padding:40px;color:rgba(45,45,45,0.4);">No messages yet. Say something!</p>';
      return;
    }

    var newMsgs = [];
    var latestTime = lastKnownTime;
    var messages = [];
    snapshot.forEach(function(child) {
      var msg = child.val();
      msg._key = child.key;
      messages.push(msg);
      if (msg.createdAt && msg.createdAt > lastKnownTime) {
        newMsgs.push(msg);
      }
      if (msg.createdAt && msg.createdAt > latestTime) {
        latestTime = msg.createdAt;
      }
    });

    lastKnownTime = latestTime;

    // Decrypt all messages before rendering
    var decryptPromises = messages.map(function(msg) {
      return decryptMsgInPlace(msg, groupConvPath);
    });
    Promise.all(decryptPromises).then(function() {
      if (!isWindowFocused && newMsgs.length > 0) {
        newMsgs.forEach(function(msg) {
          if (msg.senderId !== currentUser.uid) {
            notifyMessage(msg, groupName);
          }
        });
      }

      messages.forEach(function(msg) {
        appendMessage(msg, messageList);
      });
      scrollToBottom();
    });
  });
}

function generateJoinCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function createGroup() {
  var nameInput = document.getElementById('group-name-input');
  var name = nameInput.value.trim();
  if (!name) { showToast('Please enter a group name.'); return; }

  var code = generateJoinCode();
  var myUid = auth.currentUser.uid;
  var groupData = {
    name: name,
    createdBy: myUid,
    joinCode: code,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    members: {}
  };
  groupData.members[myUid] = true;

  db.ref('groups').push(groupData).then(function() {
    hideCreateGroupModal();
    nameInput.value = '';
    showToast('Group created! Code: ' + code + ' — share it with friends.');
  }).catch(function(err) {
    showToast('Failed to create group: ' + err.message);
  });
}

function joinGroup() {
  var codeInput = document.getElementById('join-code-input');
  var code = codeInput.value.trim().toUpperCase();
  if (!code) { showToast('Please enter a join code.'); return; }

  var myUid = auth.currentUser.uid;
  db.ref('groups').orderByChild('joinCode').equalTo(code).once('value').then(function(snapshot) {
    var found = false;
    snapshot.forEach(function(child) {
      found = true;
      var grp = child.val();
      if (grp.members && grp.members[myUid]) {
        showToast('You are already in this group.');
        return;
      }
      db.ref('groups/' + child.key + '/members/' + myUid).set(true).then(function() {
        hideJoinGroupModal();
        codeInput.value = '';
        showToast('Joined group!');
      });
    });
    if (!found) {
      showToast('Invalid join code.');
    }
  });
}

function showCreateGroupModal() {
  document.getElementById('create-group-modal').style.display = 'flex';
  document.getElementById('group-name-input').value = '';
  document.getElementById('group-name-input').focus();
}

function hideCreateGroupModal() {
  document.getElementById('create-group-modal').style.display = 'none';
}

function showJoinGroupModal() {
  document.getElementById('join-group-modal').style.display = 'flex';
  document.getElementById('join-code-input').value = '';
  document.getElementById('join-code-input').focus();
}

function hideJoinGroupModal() {
  document.getElementById('join-group-modal').style.display = 'none';
}

// ===== TYPING INDICATOR =====

function startTypingListener(basePath) {
  var indicator = document.getElementById('typing-indicator');
  if (currentTypingRef) {
    currentTypingRef.off();
    currentTypingRef = null;
  }
  indicator.style.display = 'none';
  indicator.textContent = '';
  currentTypingRef = db.ref(basePath + '/typing');
  currentTypingRef.on('value', function(snapshot) {
    var uid = auth.currentUser.uid;
    var names = [];
    var now = Date.now();
    snapshot.forEach(function(child) {
      if (child.key === uid) return;
      var ts = child.val();
      if (!ts || now - ts > 3000) return;
      names.push(child.key);
    });
    if (names.length === 0) {
      indicator.style.display = 'none';
      indicator.textContent = '';
      return;
    }
    // Resolve names
    var resolved = [];
    var pending = names.map(function(id) {
      return db.ref('users/' + id + '/displayName').once('value').then(function(snap) {
        resolved.push(snap.val() || 'Someone');
      });
    });
    Promise.all(pending).then(function() {
      if (resolved.length === 0) { indicator.style.display = 'none'; return; }
      var text = resolved.join(', ') + (resolved.length === 1 ? ' is' : ' are') + ' typing...';
      indicator.textContent = text;
      indicator.style.display = 'block';
    });
  });
}

// ===== CHAT STATS =====

function showChatStats() {
  var modal = document.getElementById('chat-stats-modal');
  var title = document.getElementById('stats-title');
  var created = document.getElementById('stats-created');
  var body = document.getElementById('stats-body');

  var convPath, convName;
  if (currentChannelId) {
    convPath = 'channels/' + currentChannelId;
    convName = '#' + currentChannelId;
  } else if (currentDmId) {
    convPath = 'dms/' + currentDmId;
    convName = 'DM';
  } else if (currentGroupId) {
    convPath = 'groups/' + currentGroupId;
    convName = document.querySelector('#group-list .sidebar-item.active span')?.textContent || 'Group';
  } else {
    return;
  }

  title.textContent = convName;
  created.textContent = 'Loading...';
  body.innerHTML = '';

  db.ref(convPath).once('value').then(function(snap) {
    var data = snap.val();
    if (!data) return;
    if (data.createdAt) {
      var d = new Date(data.createdAt);
      var days = Math.floor((Date.now() - data.createdAt) / 86400000);
      created.textContent = 'Created ' + d.toDateString() + ' (' + days + ' day' + (days === 1 ? '' : 's') + ' ago)';
    } else {
      created.textContent = '';
    }
  });

  db.ref(convPath + '/messages').once('value').then(function(snap) {
    var counts = {};
    var total = 0;
    snap.forEach(function(child) {
      var msg = child.val();
      if (msg && msg.senderId) {
        counts[msg.senderId] = (counts[msg.senderId] || 0) + 1;
        total++;
      }
    });
    var members = Object.keys(counts).length;
    var html = '<p><strong>' + members + ' member' + (members === 1 ? '' : 's') + '</strong> &middot; ' + total + ' message' + (total === 1 ? '' : 's') + '</p>';
    var uidOrder = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; });
    var pendingNames = uidOrder.map(function(id) {
      return db.ref('users/' + id + '/displayName').once('value').then(function(snap) {
        return { id: id, name: snap.val() || 'Unknown', count: counts[id] };
      });
    });
    Promise.all(pendingNames).then(function(users) {
      html += '<table style="width:100%;border-collapse:collapse;">';
      html += '<tr style="border-bottom:1px solid var(--color-border);"><th style="text-align:left;padding:4px;">User</th><th style="text-align:right;padding:4px;">Messages</th></tr>';
      users.forEach(function(u) {
        var pct = ((u.count / total) * 100).toFixed(1);
        html += '<tr><td style="padding:4px;">' + u.name + '</td><td style="text-align:right;padding:4px;">' + u.count + ' (' + pct + '%)</td></tr>';
      });
      html += '</table>';
      body.innerHTML = html;
    });
  });

  modal.style.display = 'flex';
}

function hideChatStats() {
  document.getElementById('chat-stats-modal').style.display = 'none';
}

// ===== IMAGE VIEWER =====

var _ivZoom = 1;
function openImageViewer(src) {
  var img = document.getElementById('iv-image');
  img.src = src;
  _ivZoom = 1;
  img.style.transform = 'scale(1)';
  document.getElementById('iv-zoom-pct').textContent = '100%';
  document.getElementById('image-viewer-modal').style.display = 'flex';
}

function closeImageViewer() {
  document.getElementById('image-viewer-modal').style.display = 'none';
  document.getElementById('iv-image').src = '';
}

function zoomImageViewer(delta) {
  _ivZoom = Math.max(0.1, Math.min(10, _ivZoom + delta));
  document.getElementById('iv-image').style.transform = 'scale(' + _ivZoom + ')';
  document.getElementById('iv-zoom-pct').textContent = Math.round(_ivZoom * 100) + '%';
}

function ivZoomWheel(e) {
  e.preventDefault();
  var d = e.deltaY > 0 ? -0.1 : 0.1;
  zoomImageViewer(d);
}

function fitImageViewer() {
  _ivZoom = 1;
  document.getElementById('iv-image').style.transform = 'scale(1)';
  document.getElementById('iv-zoom-pct').textContent = '100%';
}

function downloadImageViewer() {
  var src = document.getElementById('iv-image').src;
  if (!src) return;
  var a = document.createElement('a');
  a.href = src;
  a.download = 'scribble-image.jpg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ===== GROUP DELETE / LEAVE =====

var _deleteGroupId = null;
var _deleteGroupIsCreator = false;

function showDeleteGroupModal(groupId, isCreator) {
  _deleteGroupId = groupId;
  _deleteGroupIsCreator = isCreator;
  var modal = document.getElementById('delete-group-modal');
  var title = document.getElementById('delete-group-title');
  var desc = document.getElementById('delete-group-desc');
  var btn = document.getElementById('confirm-delete-group-btn');

  if (isCreator) {
    title.textContent = 'Delete Group';
    desc.textContent = 'This will permanently delete the group for all members. This cannot be undone.';
    btn.textContent = 'Delete Group';
    btn.className = 'btn btn-danger';
  } else {
    title.textContent = 'Leave Group';
    desc.textContent = 'Are you sure you want to leave this group?';
    btn.textContent = 'Leave Group';
    btn.className = 'btn btn-danger';
  }

  var newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', function() {
    modal.style.display = 'none';
    if (isCreator) {
      deleteGroup(groupId);
    } else {
      leaveGroup(groupId);
    }
  });

  modal.style.display = 'flex';
}

function deleteGroup(groupId) {
  var myUid = auth.currentUser.uid;
  db.ref('groups/' + groupId + '/members').once('value').then(function(snap) {
    var members = snap.val();
    var updates = {};
    updates['groups/' + groupId] = null;
    if (members) {
      Object.keys(members).forEach(function(uid) {
        updates['userGroups/' + uid + '/' + groupId] = null;
      });
    }
    return db.ref().update(updates);
  }).then(function() {
    if (currentGroupId === groupId) {
      currentGroupId = null;
      switchToChannel('general');
    }
    showToast('Group deleted');
  });
}

function leaveGroup(groupId) {
  var myUid = auth.currentUser.uid;
  var updates = {};
  updates['groups/' + groupId + '/members/' + myUid] = null;
  updates['userGroups/' + myUid + '/' + groupId] = null;
  db.ref().update(updates).then(function() {
    if (currentGroupId === groupId) {
      currentGroupId = null;
      switchToChannel('general');
    }
    showToast('Left group');
  });
}

// ===== VERSION REPORTING & UPDATE BANNER =====

function reportVersion() {
  if (!window.__TAURI__) return;
  window.__TAURI__.app.getVersion().then(function(version) {
    db.ref('appVersion/clients/' + currentUser.uid).set({
      version: version,
      reportedAt: firebase.database.ServerValue.TIMESTAMP
    });
  });
}

function applyUISettings() {
  var scale = parseFloat(localStorage.getItem('uiScale')) || 1;
  if (scale !== 1) document.body.style.zoom = scale;

  if (localStorage.getItem('dmCollapsed') === '1') {
    var list = document.getElementById('dm-list');
    var arrow = document.getElementById('dm-collapse-arrow');
    if (list) list.style.display = 'none';
    if (arrow) arrow.classList.add('collapsed');
  }
}

function showReleaseNotes() {
  if (!window.__TAURI__) return;
  window.__TAURI__.app.getVersion().then(function(myVersion) {
    db.ref('appVersion').once('value').then(function(snap) {
      var data = snap.val();
      if (!data || !data.latest) return;
      if (data.latest === localStorage.getItem('seenVersion')) return;
      if (!isNewerVersion(myVersion, data.latest)) return;

      // Collect notes from all versions newer than current
      var releases = data.releases;
      if (!releases) return;
      var versionList = Object.keys(releases).map(function(k) { return k.replace(/_/g, '.'); });
      var newerVersions = versionList.filter(function(v) { return isNewerVersion(myVersion, v); });
      newerVersions.sort(function(a, b) {
        var aa = a.split('.').map(Number);
        var bb = b.split('.').map(Number);
        for (var i = 0; i < 3; i++) {
          if (aa[i] !== bb[i]) return aa[i] - bb[i];
        }
        return 0;
      });

      if (newerVersions.length === 0) return;

      var allNotes = '';
      var count = 0;
      var remaining = newerVersions.length;

      newerVersions.forEach(function(v) {
        var safeKey = v.replace(/\./g, '_');
        db.ref('appVersion/releases/' + safeKey + '/notes').once('value').then(function(notesSnap) {
          var notes = notesSnap.val();
          if (notes) {
            if (count > 0) allNotes += '\n\n---\n\n';
            allNotes += notes;
            count++;
          }
          remaining--;
          if (remaining === 0) {
            document.getElementById('release-notes-version').textContent = 'v' + data.latest;
            document.getElementById('release-notes-body').textContent = allNotes || 'See announcements for details.';
            document.getElementById('release-notes-modal').style.display = 'flex';
          }
        });
      });
    });
  });
}

function dismissReleaseNotes() {
  db.ref('appVersion/latest').once('value').then(function(snap) {
    if (snap.val()) localStorage.setItem('seenVersion', snap.val());
  });
  document.getElementById('release-notes-modal').style.display = 'none';
  // Switch to announcements channel so user sees the changelog
  switchToChannel('announcements');
}

function hideReleaseNotes() {
  document.getElementById('release-notes-modal').style.display = 'none';
}

function isNewerVersion(current, latest) {
  var ca = current.split('.').map(Number);
  var la = latest.split('.').map(Number);
  for (var i = 0; i < 3; i++) {
    if (la[i] > ca[i]) return true;
    if (la[i] < ca[i]) return false;
  }
  return false;
}

function checkForUpdates() {
  if (!window.__TAURI__) return;
  window.__TAURI__.app.getVersion().then(function(myVersion) {
    db.ref('appVersion').on('value', function(snapshot) {
      var data = snapshot.val();
      if (!data || !data.latest) return;
      if (isNewerVersion(myVersion, data.latest)) {
        showUpdateBanner(data.latest, data.downloadUrl || '');
      }
    });
  });
}

function showUpdateBanner(version, url) {
  if (document.getElementById('update-banner')) return;
  var banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.innerHTML =
    '<span>Update available: <strong>v' + version + '</strong></span>' +
    '<button id="update-download-btn" class="btn" style="padding:4px 16px;min-height:36px;font-size:0.9rem;margin-left:auto;">Download</button>' +
    '<button id="update-dismiss-btn" style="background:none;border:none;cursor:pointer;font-size:1.2rem;padding:4px 8px;color:inherit;">✕</button>';
  banner.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--color-secondary);color:#fff;font-size:0.9rem;flex-shrink:0;';

  var messageArea = document.querySelector('.message-area');
  if (!messageArea) return;
  messageArea.insertBefore(banner, messageArea.firstChild);

  document.getElementById('update-download-btn').addEventListener('click', function() {
    if (window.__TAURI__ && url) {
      var btn = this;
      btn.textContent = 'Downloading...';
      btn.disabled = true;
      window.__TAURI__.core.invoke('download_installer', { url: url }).then(function(path) {
        btn.textContent = 'Installing...';
      }).catch(function(err) {
        btn.textContent = 'Download Failed';
        console.error('Download failed:', err);
      });
    } else if (url) {
      window.open(url, '_blank');
    }
  });
  document.getElementById('update-dismiss-btn').addEventListener('click', function() {
    banner.remove();
  });
}

window.addEventListener('beforeunload', function() {
  if (auth.currentUser) {
    db.ref('users/' + auth.currentUser.uid + '/status').set({
      online: false,
      focus: false,
      lastSeen: firebase.database.ServerValue.TIMESTAMP
    });
  }
});

window.addEventListener('resize', function() {
  if (window.innerWidth >= 981) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
  }
});
