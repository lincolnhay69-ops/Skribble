var currentUser = null;
var currentChannelId = null;
var currentDmId = null;
var currentGroupId = null;
var currentMsgQuery = null;
var dmListVersion = 0;
var ADMIN_UID = 'wVaQg5UcbIS1DavXddSMoMg8etB2';
var selectedProfileUid = null;

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

  var avatarContainer = document.getElementById('user-avatar');
  if (avatarContainer && currentUser.displayName) {
    avatarContainer.innerHTML = '<span class="avatar avatar-sm avatar-fallback" style="cursor:pointer;" onclick="window.location.href=\'profile.html\'">' + currentUser.displayName.charAt(0).toUpperCase() + '</span>';
  }

  loadChannels();
  loadDMs();
  loadGroups();
  reportVersion();
  checkForUpdates();
  switchToChannel('general');
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
          div.innerHTML = '<span class="avatar avatar-sm avatar-fallback" style="width:28px;height:28px;font-size:0.8rem;flex-shrink:0;">' + initial + '</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (userData.displayName || 'Unknown') + '</span>';
          div.dataset.dmId = dmId;
          div.addEventListener('click', function() { switchToDM(dmId, otherId); });

          (function(div, key) {
            var lastRead = parseInt(localStorage.getItem('lastRead_' + key)) || 0;
            if (lastRead === 0) {
              var del = document.createElement('button');
              del.className = 'dm-delete-btn';
              del.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12"/><path d="M5 4V2.5A.5.5 0 015.5 2h2a.5.5 0 01.5.5V4"/><path d="M12 4v9a1.5 1.5 0 01-1.5 1.5h-6A1.5 1.5 0 013 13V4"/></svg>';
              del.addEventListener('click', function(e) { e.stopPropagation(); deleteDM(key); });
              div.appendChild(del);
              return;
            }
            db.ref('dms/' + key + '/messages').orderByChild('createdAt').startAt(lastRead + 1).once('value', function(msgSnapshot) {
              var count = msgSnapshot.numChildren();
              if (count > 0) {
                var badge = document.createElement('span');
                badge.className = 'unread-badge';
                badge.textContent = count > 99 ? '99+' : count;
                div.appendChild(badge);
              }
              var del = document.createElement('button');
              del.className = 'dm-delete-btn';
              del.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12"/><path d="M5 4V2.5A.5.5 0 015.5 2h2a.5.5 0 01.5.5V4"/><path d="M12 4v9a1.5 1.5 0 01-1.5 1.5h-6A1.5 1.5 0 013 13V4"/></svg>';
              del.addEventListener('click', function(e) { e.stopPropagation(); deleteDM(key); });
              div.appendChild(del);
            });
          })(div, dmId);

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
      messages.push(msg);
      if (msg.createdAt && msg.createdAt > lastKnownTime) {
        newMsgs.push(msg);
      }
      if (msg.createdAt && msg.createdAt > latestTime) {
        latestTime = msg.createdAt;
      }
    });

    if (document.hidden && newMsgs.length > 0) {
      newMsgs.forEach(function(msg) {
        if (msg.senderId !== currentUser.uid) {
          notifyMessage(msg, '#' + channelId);
        }
      });
    }

    lastKnownTime = latestTime;

    messages.forEach(function(msg) {
      appendMessage(msg, messageList);
    });
    scrollToBottom();
  });
}

function switchToDM(dmId, otherUserId) {
  currentDmId = dmId;
  currentChannelId = null;
  currentGroupId = null;

  if (currentMsgQuery) { currentMsgQuery.off(); }

  localStorage.setItem('lastRead_' + dmId, Date.now());
  updateSidebarActive();

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
      messages.push(msg);
      if (msg.createdAt && msg.createdAt > lastKnownTime) {
        newMsgs.push(msg);
      }
      if (msg.createdAt && msg.createdAt > latestTime) {
        latestTime = msg.createdAt;
      }
    });

    if (document.hidden && newMsgs.length > 0) {
      newMsgs.forEach(function(msg) {
        if (msg.senderId !== currentUser.uid) {
          notifyMessage(msg, msg.senderName);
        }
      });
    }

    lastKnownTime = latestTime;

    messages.forEach(function(msg) {
      appendMessage(msg, messageList);
    });
    scrollToBottom();
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

  if (msg.text) {
    var div = document.createElement('div');
    div.className = isMine ? 'message-mine' : 'message-other';

    if (!isMine && (currentChannelId || currentGroupId)) {
      var name = document.createElement('div');
      name.style.fontSize = '0.75rem';
      name.style.fontWeight = '700';
      name.style.marginBottom = '4px';
      name.textContent = msg.senderName;
      div.appendChild(name);
    }

    var text = document.createElement('span');
    text.textContent = msg.text;
    div.appendChild(text);
    container.appendChild(div);
  }

  if (msg.imageURL) {
    var wrapper = document.createElement('div');
    wrapper.className = 'message-image tape';
    wrapper.style.marginLeft = isMine ? 'auto' : '0';
    wrapper.style.marginRight = isMine ? '0' : 'auto';

    if (!isMine && (currentChannelId || currentGroupId)) {
      var name = document.createElement('div');
      name.style.fontSize = '0.7rem';
      name.style.fontWeight = '700';
      name.style.padding = '4px 8px';
      name.style.borderBottom = '1px dashed var(--color-border)';
      name.textContent = msg.senderName;
      wrapper.appendChild(name);
    }

    var img = document.createElement('img');
    img.src = msg.imageURL;
    img.alt = 'Shared image';
    img.style.width = '100%';
    img.style.display = 'block';
    wrapper.appendChild(img);
    container.appendChild(wrapper);
  }
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

  var msg = {
    senderId: currentUser.uid,
    senderName: currentUser.displayName,
    text: text,
    imageURL: null,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  };

  if (currentChannelId) {
    db.ref('channels/' + currentChannelId + '/messages').push(msg);
  } else if (currentDmId) {
    db.ref('dms/' + currentDmId + '/messages').push(msg);
  } else if (currentGroupId) {
    db.ref('groups/' + currentGroupId + '/messages').push(msg);
  }

  input.value = '';
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

  var storageRef = storage.ref('images/' + Date.now() + '_' + file.name);
  storageRef.put(file).then(function(snapshot) {
    return snapshot.ref.getDownloadURL();
  }).then(function(url) {
    var msg = {
      senderId: currentUser.uid,
      senderName: currentUser.displayName,
      text: null,
      imageURL: url,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    };

    if (currentChannelId) {
      db.ref('channels/' + currentChannelId + '/messages').push(msg);
    } else if (currentDmId) {
      db.ref('dms/' + currentDmId + '/messages').push(msg);
    } else if (currentGroupId) {
      db.ref('groups/' + currentGroupId + '/messages').push(msg);
    }
  }).catch(function(err) {
    console.error('Upload failed:', err);
  });

  event.target.value = '';
}

function notifyMessage(msg, source) {
  if (!window.__TAURI__) return;
  var title = "Scribble - " + source;
  var body = (msg.senderName || "Someone") + ": " + (msg.text || "Image");
  window.__TAURI__.core.invoke('notify', { title: title, body: body });
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
    db.ref('friendRequests').once('value')
  ]).then(function(results) {
    var usersSnapshot = results[0];
    var reqSnapshot = results[1];
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

      var status = relMap[child.key];
      var badgeHtml = '';
      if (status === 'pending') badgeHtml = '<span class="relationship-badge pending">Pending</span>';
      else if (status === 'request') badgeHtml = '<span class="relationship-badge request">Request</span>';
      else if (status === 'accepted') badgeHtml = '<span class="relationship-badge friend">Friend</span>';

      var initial = userData.displayName ? userData.displayName.charAt(0).toUpperCase() : '?';
      div.innerHTML = '<span class="avatar avatar-sm avatar-fallback" style="width:28px;height:28px;font-size:0.8rem;flex-shrink:0;">' + initial + '</span><span>' + (userData.displayName || 'Unknown') + '</span>' + badgeHtml;
      (function(uid) {
        div.addEventListener('click', function() { showUserProfile(uid); });
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

  Promise.all([
    db.ref('users/' + uid).once('value'),
    db.ref('friendRequests').once('value')
  ]).then(function(results) {
    var userSnapshot = results[0];
    if (!userSnapshot.exists()) return;
    var userData = userSnapshot.val();
    var reqSnapshot = results[1];

    var myUid = auth.currentUser.uid;
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

    if (myRequest && myRequest.status === 'pending') {
      var lastBump = myRequest.lastBump || 0;
      var cooldown = 3600000 - (Date.now() - lastBump);
      if (cooldown > 0) {
        var min = Math.ceil(cooldown / 60000);
        actionsHtml = '<button class="btn friend-btn" disabled>Pending (' + min + 'm)</button>';
      } else {
        actionsHtml = '<button class="btn friend-btn" onclick="bumpFriendRequest(\'' + uid + '\')">Bump Request</button>';
      }
    } else if (theirRequest && theirRequest.status === 'pending') {
      actionsHtml = '<button class="btn friend-btn" style="background:var(--color-secondary);color:#fff;" onclick="acceptFriendRequest(\'' + uid + '\')">Accept Request</button><button class="btn btn-secondary friend-btn" onclick="declineFriendRequest(\'' + uid + '\')">Decline</button>';
    } else if ((myRequest && myRequest.status === 'accepted') || (theirRequest && theirRequest.status === 'accepted')) {
      actionsHtml = '<button class="btn friend-btn" style="background:var(--color-secondary);color:#fff;" onclick="startDM(\'' + uid + '\')">Message</button>';
    } else {
      actionsHtml = '<button class="btn friend-btn" onclick="sendFriendRequest(\'' + uid + '\')">Send Friend Request</button>';
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

function shareProfile(uid) {
  navigator.clipboard.writeText('Scribble profile: ' + window.location.origin + '/?user=' + uid).then(function() {
    showToast('Profile link copied!');
  }).catch(function() {
    showToast('Profile: ' + uid);
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
      list.appendChild(div);
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

  db.ref('groups/' + groupId).once('value').then(function(snapshot) {
    if (snapshot.exists()) {
      document.getElementById('current-channel-name').innerHTML = groupIcon + ' ' + snapshot.val().name;
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
      messages.push(msg);
      if (msg.createdAt && msg.createdAt > lastKnownTime) {
        newMsgs.push(msg);
      }
      if (msg.createdAt && msg.createdAt > latestTime) {
        latestTime = msg.createdAt;
      }
    });

    if (document.hidden && newMsgs.length > 0) {
      newMsgs.forEach(function(msg) {
        if (msg.senderId !== currentUser.uid) {
          notifyMessage(msg, grp.name || 'Group');
        }
      });
    }

    lastKnownTime = latestTime;

    messages.forEach(function(msg) {
      appendMessage(msg, messageList);
    });
    scrollToBottom();
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
      window.__TAURI__.core.invoke('open_url', { url: url });
    } else if (url) {
      window.open(url, '_blank');
    }
  });
  document.getElementById('update-dismiss-btn').addEventListener('click', function() {
    banner.remove();
  });
}

window.addEventListener('resize', function() {
  if (window.innerWidth >= 768) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
  }
});
