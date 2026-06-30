var currentUser = null;
var myDisplayName = '';
var currentChannelId = null;
var currentDmId = null;
var currentDmPeerId = null;
var currentGroupId = null;
var currentMsgQuery = null;
var currentTypingRef = null;
var myUserColour = '#2d5da1';
var dmListVersion = 0;
var ADMIN_UID = 'wVaQg5UcbIS1DavXddSMoMg8etB2';
var selectedProfileUid = null;
var isWindowFocused = true;
var friendRequestCount = 0;
var nicknameCache = {};
var renameTargetUid = null;
var callState = 'IDLE';
var currentCallId = null;
var remotePeerId = null;
var localStream = null;
var remoteStream = null;
var peerConnection = null;
var callStartTime = null;
var callTimerInterval = null;
var _callStatusRef = null;
var _callerIceRef = null;
var _calleeIceRef = null;
var _incomingCallRef = null;
var _ringtoneCtx = null;
var _ringtoneInterval = null;

function getCallId(a, b) {
  return [a, b].sort().join('_call_');
}

function getIceServers() {
  return { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]};
}

function getFriendName(uid, fallback) {
  return nicknameCache[uid] || fallback || 'Unknown';
}

function loadNicknames() {
  db.ref('users/' + auth.currentUser.uid + '/nicknames').once('value', function(snapshot) {
    if (snapshot.exists()) nicknameCache = snapshot.val();
  });
}

function renameFriend(uid) {
  renameTargetUid = uid;
  var input = document.getElementById('rename-input');
  input.value = nicknameCache[uid] || '';
  document.getElementById('rename-modal').style.display = 'flex';
  input.focus();
  input.select();
}

function saveRename() {
  var uid = renameTargetUid;
  if (!uid) return;
  var input = document.getElementById('rename-input');
  var newName = input.value.trim();
  var ref = db.ref('users/' + auth.currentUser.uid + '/nicknames/' + uid);
  if (newName) {
    ref.set(newName);
    nicknameCache[uid] = newName;
  } else {
    ref.remove();
    delete nicknameCache[uid];
  }
  document.getElementById('rename-modal').style.display = 'none';
  loadDMs();
  if (document.getElementById('user-options-modal').style.display === 'flex') showUserOptions(uid);
  if (document.getElementById('profile-card') && selectedProfileUid === uid) showProfile(uid);
  if (currentDmId) {
    var otherId = currentDmId.split('_').filter(function(id) { return id !== auth.currentUser.uid; })[0];
    if (otherId === uid) {
      db.ref('users/' + otherId + '/displayName').once('value', function(snapshot) {
        if (snapshot.exists()) {
          var name = getFriendName(otherId, snapshot.val().displayName) || 'Unknown';
          var callBtnHtml = '<span style="cursor:pointer;margin-left:8px;opacity:0.5;transition:opacity 0.15s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.5" onclick="event.stopPropagation();startCall(\'' + otherId + '\')" title="Call">' +
            '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M14.5 11.5c-2.5 2-5.5 3-8.5 3s-6-1-8.5-3a1 1 0 01-.3-1l1.5-2a1 1 0 011-.5l2 .5a1 1 0 01.6.7l.5 1.5"/>' +
            '<path d="M11.7 9.2l.5-1.5a1 1 0 01.6-.7l2-.5a1 1 0 011 .5l1.5 2a1 1 0 01-.3 1"/>' +
            '</svg></span>';
          document.getElementById('current-channel-name').innerHTML = '<span>' + name + '</span>' + callBtnHtml;
        }
      });
    }
  }
  if (document.querySelectorAll('#message-list .message-row').length > 0) {
    document.querySelectorAll('#message-list .message-row').forEach(function(row) {
      var sid = row.dataset.senderId;
      if (sid === uid) {
        var names = row.querySelectorAll('.msg-sender-name');
        names.forEach(function(el) {
          el.textContent = nicknameCache[uid] || el.dataset.originalName || el.textContent;
          if (!el.dataset.originalName) el.dataset.originalName = el.textContent;
        });
      }
    });
  }
}

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
    var pendingReqs = [];
    var newestRequest = null;

    snapshot.forEach(function(child) {
      var req = child.val();
      req._key = child.key;
      if (req.status === 'pending') {
        pendingReqs.push(req);
        if (!newestRequest || (req.createdAt || 0) > (newestRequest.createdAt || 0)) {
          newestRequest = req;
        }
      }
    });

    if (pendingReqs.length === 0) {
      friendRequestCount = 0;
      renderFriendRequests([]);
      updateFriendBadge(0, null, prevCount, isWindowFocused);
      return;
    }

    // Filter out blocked users
    db.ref('users/' + myUid + '/blocked').once('value', function(blockSnap) {
      var blockedMap = blockSnap.val() || {};
      var unblockedReqs = pendingReqs.filter(function(req) { return !blockedMap[req.from]; });
      friendRequestCount = unblockedReqs.length;
      renderFriendRequests(unblockedReqs);
      updateFriendBadge(friendRequestCount, newestRequest, prevCount, isWindowFocused);
    });
  });
}

function renderFriendRequests(requests) {
  var list = document.getElementById('fr-list');
  if (!list) return;
  list.innerHTML = '';
  if (requests.length === 0) { list.style.display = 'none'; return; }
  list.style.display = '';
  requests.forEach(function(req) {
    db.ref('users/' + req.from + '/displayName').once('value', function(nameSnap) {
      var name = nameSnap.val() || 'Unknown';
      db.ref('users/' + req.from + '/avatarColour').once('value', function(colSnap) {
        var colour = colSnap.val() || '#2d5da1';
        var initial = name.charAt(0).toUpperCase();
        var item = document.createElement('div');
        item.className = 'sidebar-item';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '8px';
        item.style.padding = '6px 12px';
        item.style.cursor = 'default';
        item.innerHTML =
          '<span class="avatar avatar-sm" style="background:' + colour + ';flex-shrink:0;">' + initial + '</span>' +
          '<span style="flex:1;font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + name + '</span>' +
          '<button class="btn" style="padding:2px 8px;min-height:26px;font-size:0.7rem;" onclick="acceptFriendRequest(\'' + req.from + '\');event.stopPropagation();">✓</button>' +
          '<button class="btn btn-secondary" style="padding:2px 8px;min-height:26px;font-size:0.7rem;" onclick="declineFriendRequest(\'' + req.from + '\');event.stopPropagation();">✗</button>';
        list.appendChild(item);
      });
    });
  });
}

function updateFriendBadge(count, newestRequest, prevCount, windowFocused) {
  var badge = document.getElementById('fr-badge');
  if (badge) {
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
  }
  if (newestRequest && count > prevCount) {
    var reqFrom = newestRequest.from;
    db.ref('users/' + reqFrom + '/displayName').once('value', function(nameSnap) {
      var name = nameSnap.val() || 'Someone';
      playNotificationSound();
      if (windowFocused) {
        showToast('Friend request from ' + name);
      } else {
        notifyMessage({ senderId: reqFrom, senderName: name, text: 'Sent you a friend request' }, 'Friend Request');
      }
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

function renderSidebarAvatar() {
  var avatarContainer = document.getElementById('user-avatar');
  if (!avatarContainer) return;
  db.ref('users/' + auth.currentUser.uid).once('value').then(function(snapshot) {
    var data = snapshot.val() || {};
    var displayName = data.displayName || auth.currentUser.displayName || '?';
    myDisplayName = displayName;
    var colour = data.avatarColour || '#2d5da1';
    var initial = displayName.charAt(0).toUpperCase();
    avatarContainer.innerHTML = '<div class="avatar-wrap"><span class="avatar avatar-sm" style="cursor:pointer;background:' + colour + ';" onclick="window.location.href=\'profile.html\'">' + initial + '</span><span class="status-dot ' + (isWindowFocused ? 'online' : 'away') + '" id="own-status-dot"></span></div>';
  });
}

function repairUserRecord() {
  var uid = auth.currentUser.uid;
  db.ref('users/' + uid).once('value').then(function(snapshot) {
    var data = snapshot.val();
    if (!data) {
      db.ref('users/' + uid).set({
        displayName: auth.currentUser.displayName || 'Unnamed',
        avatarColour: '#2d5da1',
        lastNameChange: 0,
        accentEnabled: false,
        status: { online: true, lastSeen: firebase.database.ServerValue.TIMESTAMP, focus: false },
        followers: {},
        following: {},
        createdAt: firebase.database.ServerValue.TIMESTAMP
      });
      myUserColour = '#2d5da1';
      document.body.style.setProperty('--user-colour', '#2d5da1');
      renderSidebarAvatar();
      return;
    }
    myUserColour = data.avatarColour || '#2d5da1';
    document.body.style.setProperty('--user-colour', myUserColour);
    var updates = {};
    var needsUpdate = false;
    if (!data.avatarColour) { updates.avatarColour = '#2d5da1'; needsUpdate = true; }
    if (!data.hasOwnProperty('lastNameChange')) { updates.lastNameChange = 0; needsUpdate = true; }
    if (!data.status) { updates.status = { online: true, lastSeen: firebase.database.ServerValue.TIMESTAMP, focus: false }; needsUpdate = true; }
    if (!data.followers) { updates.followers = {}; needsUpdate = true; }
    if (!data.following) { updates.following = {}; needsUpdate = true; }
    if (!data.createdAt) { updates.createdAt = firebase.database.ServerValue.TIMESTAMP; needsUpdate = true; }
    if (data.displayName && !auth.currentUser.displayName) {
      auth.currentUser.updateProfile({ displayName: data.displayName });
    }
    if (data.accentEnabled) {
      document.body.classList.add('accent-mode');
    }
    if (needsUpdate) {
      db.ref('users/' + uid).update(updates);
    }
    renderSidebarAvatar();
  });
}

// ===== VOICE CALLS =====
function stopRingtone() {
  if (_ringtoneInterval) { clearInterval(_ringtoneInterval); _ringtoneInterval = null; }
  if (_ringtoneCtx) { _ringtoneCtx.close(); _ringtoneCtx = null; }
}

function playRingtone() {
  stopRingtone();
  _ringtoneCtx = new (window.AudioContext || window.webkitAudioContext)();
  function beep() {
    if (!_ringtoneCtx) return;
    var osc = _ringtoneCtx.createOscillator();
    var gain = _ringtoneCtx.createGain();
    osc.connect(gain);
    gain.connect(_ringtoneCtx.destination);
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0.3, _ringtoneCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _ringtoneCtx.currentTime + 0.4);
    osc.start();
    osc.stop(_ringtoneCtx.currentTime + 0.4);
  }
  beep();
  _ringtoneInterval = setInterval(beep, 800);
}

function playNotificationSound() {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    gain.gain.value = 0.3;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch(e) {}
}

function createPeerConnection() {
  var pc = new RTCPeerConnection(getIceServers());
  pc.onicecandidate = function(event) {
    if (event.candidate) {
      var role = (callState === 'CALLING') ? 'callerCandidates' : 'calleeCandidates';
      db.ref('call-ice/' + currentCallId + '/' + role).push().set(event.candidate.toJSON());
    }
  };
  pc.ontrack = function(event) {
    remoteStream = event.streams[0];
    var el = document.getElementById('call-remote-audio');
    if (!el) { el = document.createElement('audio'); el.id = 'call-remote-audio'; el.autoplay = true; document.body.appendChild(el); }
    el.srcObject = remoteStream;
    el.play().catch(function(){});
  };
  pc.oniceconnectionstatechange = function() {
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      if (callState !== 'CONNECTED') {
        callState = 'CONNECTED';
        db.ref('calls/' + currentCallId + '/status').set('connected');
        db.ref('user-calls/' + auth.currentUser.uid + '/currentCall').set(currentCallId);
        db.ref('user-calls/' + remotePeerId + '/currentCall').set(currentCallId);
        showToast('Call connected');
        document.getElementById('call-status-text').textContent = 'Connected';
        startCallTimer();
        showCallBar();
      }
    } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
      if (callState === 'CONNECTED' || callState === 'CONNECTING') {
        showToast('Call disconnected');
        if (currentCallId) db.ref('calls/' + currentCallId + '/status').set('ended');
        cleanupCall();
      }
    }
  };
  peerConnection = pc;
  return pc;
}

function listenForCallerIce() {
  if (_callerIceRef) _callerIceRef.off();
  _callerIceRef = db.ref('call-ice/' + currentCallId + '/callerCandidates');
  _callerIceRef.on('child_added', function(snap) {
    if (peerConnection && snap.key !== '_init') {
      try { peerConnection.addIceCandidate(new RTCIceCandidate(snap.val())); } catch(e) {}
    }
  });
  _callerIceRef.once('value', function(snap) {
    if (!snap.hasChild('_init')) db.ref('call-ice/' + currentCallId + '/callerCandidates/_init').set(true);
  });
}

function listenForCalleeIce() {
  if (_calleeIceRef) _calleeIceRef.off();
  _calleeIceRef = db.ref('call-ice/' + currentCallId + '/calleeCandidates');
  _calleeIceRef.on('child_added', function(snap) {
    if (peerConnection && snap.key !== '_init') {
      try { peerConnection.addIceCandidate(new RTCIceCandidate(snap.val())); } catch(e) {}
    }
  });
  _calleeIceRef.once('value', function(snap) {
    if (!snap.hasChild('_init')) db.ref('call-ice/' + currentCallId + '/calleeCandidates/_init').set(true);
  });
}

function listenForCallStatus() {
  if (_callStatusRef) _callStatusRef.off();
  _callStatusRef = db.ref('calls/' + currentCallId + '/status');
  _callStatusRef.on('value', function(snap) {
    var status = snap.val();
    if (status === 'connecting' && callState === 'CALLING') {
      db.ref('calls/' + currentCallId + '/calleeAnswer').once('value', function(answerSnap) {
        var answer = answerSnap.val();
        if (answer && peerConnection && !peerConnection.remoteDescription) {
          peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
          listenForCalleeIce();
        }
      });
    } else if (status === 'ended' || status === 'rejected' || status === 'missed') {
      if (callState !== 'IDLE') {
        var wasConnected = (callState === 'CONNECTED');
        cleanupCall();
        if (status === 'rejected') showToast('Call rejected');
        else if (status === 'missed') showToast('Call not answered');
        else if (wasConnected) showToast('Call ended');
      }
    }
  });
}

function startCall(uid) {
  if (callState !== 'IDLE') return;
  if (uid === auth.currentUser.uid) return;
  remotePeerId = uid;
  currentCallId = getCallId(auth.currentUser.uid, uid);
  callState = 'CALLING';

  db.ref('user-calls/' + uid + '/currentCall').once('value', function(snap) {
    if (snap.val()) {
      showToast('User is in another call');
      callState = 'IDLE'; currentCallId = null; remotePeerId = null;
      return;
    }

    var screen = document.getElementById('call-screen');
    if (screen) {
      screen.style.display = 'flex';
      screen.style.position = 'absolute';
    }
    document.getElementById('call-status-text').textContent = 'Calling...';
    populateAudioDevices();
    focusCallWindow();

    db.ref('users/' + uid).once('value', function(userSnap) {
      var userData = userSnap.val() || {};
      var name = getFriendName(uid, userData.displayName) || 'Unknown';
      var colour = userData.avatarColour || '#2d5da1';
      var avatar = document.getElementById('call-peer-avatar');
      if (avatar) { avatar.style.background = colour; avatar.textContent = name.charAt(0).toUpperCase(); }
      document.getElementById('call-peer-name').textContent = name;
    });

    var pc = createPeerConnection();
    listenForCalleeIce();

    navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(function(stream) {
      localStream = stream;
      stream.getAudioTracks().forEach(function(track) { pc.addTrack(track, stream); });
      return pc.createOffer();
    }).then(function(offer) {
      return pc.setLocalDescription(offer);
    }).then(function() {
      return db.ref('calls/' + currentCallId).set({
        callerId: auth.currentUser.uid,
        calleeId: uid,
        type: 'audio',
        status: 'ringing',
        startedAt: firebase.database.ServerValue.TIMESTAMP,
        callerOffer: { sdp: pc.localDescription.sdp, type: pc.localDescription.type }
      });
    }).then(function() {
      return db.ref('user-calls/' + uid + '/incomingCall').set({
        callId: currentCallId, callerId: auth.currentUser.uid
      });
    }).then(function() {
      listenForCallStatus();
      setTimeout(function() {
        if (callState === 'CALLING') {
          db.ref('calls/' + currentCallId + '/status').set('missed');
          cleanupCall();
          showToast('Call not answered');
        }
      }, 30000);
    }).catch(function(err) {
      showToast('Call failed: ' + err.message);
      cleanupCall();
    });
  });
}

function incomingCall(data) {
  if (callState !== 'IDLE') return;
  var callId = data.callId;
  var callerId = data.callerId;
  currentCallId = callId;
  remotePeerId = callerId;
  callState = 'RINGING';

  db.ref('users/' + callerId).once('value', function(snap) {
    var userData = snap.val() || {};
    var name = getFriendName(callerId, userData.displayName) || 'Unknown';
    var colour = userData.avatarColour || '#2d5da1';
    var avatar = document.getElementById('incoming-caller-avatar');
    if (avatar) { avatar.style.background = colour; avatar.textContent = name.charAt(0).toUpperCase(); }
    document.getElementById('incoming-caller-name').textContent = name;
  });

  var modal = document.getElementById('incoming-call-modal');
  if (modal) modal.style.display = 'flex';

  focusCallWindow();
  // Also fire a notification for incoming call
  db.ref('users/' + callerId + '/displayName').once('value', function(nameSnap) {
    var callerName = getFriendName(callerId, nameSnap.val() || 'Someone');
    notifyMessage({ senderId: callerId, senderName: callerName, text: 'Incoming voice call...' }, 'Call');
  });

  playRingtone();

  setTimeout(function() {
    if (callState === 'RINGING') {
      db.ref('calls/' + currentCallId + '/status').set('missed');
      cleanupCall();
    }
  }, 30000);
}

function answerCall() {
  if (callState !== 'RINGING') return;
  callState = 'CONNECTING';
  stopRingtone();
  document.getElementById('incoming-call-modal').style.display = 'none';

  var screen = document.getElementById('call-screen');
  if (screen) {
    screen.style.display = 'flex';
    screen.style.position = 'absolute';
  }
  document.getElementById('call-status-text').textContent = 'Connecting...';
  populateAudioDevices();

  db.ref('users/' + remotePeerId).once('value', function(userSnap) {
    var userData = userSnap.val() || {};
    var name = getFriendName(remotePeerId, userData.displayName) || 'Unknown';
    var colour = userData.avatarColour || '#2d5da1';
    var avatar = document.getElementById('call-peer-avatar');
    if (avatar) { avatar.style.background = colour; avatar.textContent = name.charAt(0).toUpperCase(); }
    document.getElementById('call-peer-name').textContent = name;
  });

  var pc = createPeerConnection();

  navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(function(stream) {
    localStream = stream;
    stream.getAudioTracks().forEach(function(track) { pc.addTrack(track, stream); });
    return db.ref('calls/' + currentCallId + '/callerOffer').once('value');
  }).then(function(offerSnap) {
    var offer = offerSnap.val();
    if (!offer) throw new Error('No offer found');
    return pc.setRemoteDescription(new RTCSessionDescription(offer));
  }).then(function() {
    return pc.createAnswer();
  }).then(function(answer) {
    return pc.setLocalDescription(answer).then(function() {
      return db.ref('calls/' + currentCallId + '/calleeAnswer').set({
        sdp: answer.sdp, type: answer.type
      });
    });
  }).then(function() {
    return db.ref('calls/' + currentCallId + '/status').set('connecting');
  }).then(function() {
    listenForCallerIce();
    listenForCallStatus();
  }).catch(function(err) {
    showToast('Failed to answer: ' + err.message);
    cleanupCall();
  });
}

function rejectCall() {
  if (callState !== 'RINGING') return;
  stopRingtone();
  db.ref('calls/' + currentCallId + '/status').set('rejected');
  cleanupCall();
}

function hangUp() {
  if (!currentCallId) { cleanupCall(); return; }
  db.ref('calls/' + currentCallId + '/status').set('ended');
  cleanupCall();
}

function showCallBar() {
  var bar = document.getElementById('call-header-bar');
  if (bar) { bar.style.display = 'flex'; bar.style.flex = '1'; }
  var left = document.getElementById('header-left-section');
  var right = document.getElementById('header-right-section');
  if (left) { left.style.display = 'none'; left._hiddenByCall = true; }
  if (right) { right.style.display = 'none'; right._hiddenByCall = true; }
  var name = document.getElementById('call-peer-name');
  if (name) document.getElementById('call-header-name').textContent = name.textContent;
  var timer = document.getElementById('call-timer');
  if (timer) document.getElementById('call-header-timer').textContent = timer.textContent;
}

function minimizeCall() {
  document.getElementById('call-screen').style.display = 'none';
  document.getElementById('call-header-bar').style.display = 'flex';
  document.getElementById('call-header-bar').style.flex = '1';
  var left = document.getElementById('header-left-section');
  var right = document.getElementById('header-right-section');
  if (left) { left.style.display = 'none'; left._hiddenByCall = true; }
  if (right) { right.style.display = 'none'; right._hiddenByCall = true; }
  var name = document.getElementById('call-peer-name');
  if (name) document.getElementById('call-header-name').textContent = name.textContent;
  var timer = document.getElementById('call-timer');
  if (timer) document.getElementById('call-header-timer').textContent = timer.textContent;
}

function focusCallScreen() {
  document.getElementById('call-header-bar').style.display = 'none';
  document.getElementById('call-screen').style.display = 'flex';
  var left = document.getElementById('header-left-section');
  var right = document.getElementById('header-right-section');
  if (left && left._hiddenByCall) { left.style.display = 'flex'; delete left._hiddenByCall; }
  if (right && right._hiddenByCall) { right.style.display = 'flex'; delete right._hiddenByCall; }
}

function focusCallWindow() {
  if (window.__TAURI__) {
    window.__TAURI__.window.getCurrentWindow().setFocus();
    window.__TAURI__.core.invoke('show_window').catch(function() {});
  } else {
    window.focus();
  }
}

function cleanupCall() {
  stopRingtone();
  if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
  if (_callStatusRef) { _callStatusRef.off(); _callStatusRef = null; }
  if (_callerIceRef) { _callerIceRef.off(); _callerIceRef = null; }
  if (_calleeIceRef) { _calleeIceRef.off(); _calleeIceRef = null; }

  if (currentCallId && auth.currentUser) {
    var myUid = auth.currentUser.uid;
    db.ref('user-calls/' + myUid + '/incomingCall').remove();
    db.ref('user-calls/' + myUid + '/currentCall').remove();
    if (remotePeerId) db.ref('user-calls/' + remotePeerId + '/currentCall').remove();
  }

  if (localStream) { localStream.getTracks().forEach(function(t) { t.stop(); }); localStream = null; }
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  remoteStream = null;
  var audioEl = document.getElementById('call-remote-audio');
  if (audioEl) { audioEl.pause(); audioEl.srcObject = null; }
  callState = 'IDLE';
  currentCallId = null;
  remotePeerId = null;
  callStartTime = null;

  document.getElementById('incoming-call-modal').style.display = 'none';
  document.getElementById('call-screen').style.display = 'none';
  document.getElementById('call-header-bar').style.display = 'none';
  document.getElementById('call-timer').textContent = '00:00';
  document.getElementById('call-header-timer').textContent = '00:00';
  var left = document.getElementById('header-left-section');
  var right = document.getElementById('header-right-section');
  if (left && left._hiddenByCall) { left.style.display = 'flex'; delete left._hiddenByCall; }
  if (right && right._hiddenByCall) { right.style.display = 'flex'; delete right._hiddenByCall; }
}

function startCallTimer() {
  callStartTime = Date.now();
  var el = document.getElementById('call-timer');
  if (!el) return;
  if (callTimerInterval) clearInterval(callTimerInterval);
  callTimerInterval = setInterval(function() {
    var elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    var mins = Math.floor(elapsed / 60);
    var secs = elapsed % 60;
    var text = (mins < 10 ? '0' + mins : mins) + ':' + (secs < 10 ? '0' + secs : secs);
    el.textContent = text;
    var ht = document.getElementById('call-header-timer');
    if (ht) ht.textContent = text;
  }, 1000);
}

function toggleMute() {
  if (localStream) {
    var tracks = localStream.getAudioTracks();
    if (!tracks.length) return;
    var muted = !tracks[0].enabled;
    tracks.forEach(function(t) { t.enabled = !muted; });
    var btn = document.getElementById('call-mute-btn');
    var headerBtn = document.getElementById('call-header-mute');
    [btn, headerBtn].forEach(function(b) {
      if (b) {
        b.classList.toggle('muted', muted);
        b.title = muted ? 'Unmute' : 'Mute';
        b.style.background = muted ? '#e74c3c' : '';
      }
    });
    var icon = document.getElementById('call-mute-icon');
    var headerIcon = document.getElementById('call-header-mute-icon');
    if (muted) {
      var offPath = '<path d="M6.5 2.5A2 2 0 0112 4v3a2.5 2.5 0 01-5 0V4a2 2 0 01-.5-1.5z"/><path d="M3 9v0a5 5 0 005 5v0a5 5 0 005-5"/><path d="M8 14v2"/><line x1="2" y1="2" x2="14" y2="14"/>';
      if (icon) icon.innerHTML = offPath;
      if (headerIcon) headerIcon.innerHTML = offPath;
    } else {
      var onPath = '<path d="M6.5 2.5A2 2 0 0112 4v3a2.5 2.5 0 01-5 0V4a2 2 0 01-.5-1.5z"/><path d="M3 9v0a5 5 0 005 5v0a5 5 0 005-5"/><path d="M8 14v2"/>';
      if (icon) icon.innerHTML = onPath;
      if (headerIcon) headerIcon.innerHTML = onPath;
    }
  }
}

function populateAudioDevices() {
  navigator.mediaDevices.enumerateDevices().then(function(devices) {
    var micSel = document.getElementById('call-mic-select');
    var spkSel = document.getElementById('call-speaker-select');
    if (micSel) {
      var currentMic = micSel.value;
      micSel.innerHTML = '<option value="">Default Microphone</option>';
      devices.forEach(function(d) {
        if (d.kind === 'audioinput') {
          var opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = d.label || 'Microphone (' + d.deviceId.slice(0,8) + '...)';
          if (d.deviceId === currentMic) opt.selected = true;
          micSel.appendChild(opt);
        }
      });
    }
    if (spkSel) {
      var currentSpk = spkSel.value;
      spkSel.innerHTML = '<option value="">Default Speaker</option>';
      devices.forEach(function(d) {
        if (d.kind === 'audiooutput') {
          var opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = d.label || 'Speaker (' + d.deviceId.slice(0,8) + '...)';
          if (d.deviceId === currentSpk) opt.selected = true;
          spkSel.appendChild(opt);
        }
      });
    }
  }).catch(function(){});
}

function switchMic(deviceId) {
  if (!localStream || !peerConnection) return;
  var constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false };
  navigator.mediaDevices.getUserMedia(constraints).then(function(newStream) {
    var newTrack = newStream.getAudioTracks()[0];
    if (!newTrack) { newStream.getTracks().forEach(function(t){t.stop();}); return; }
    var sender = peerConnection.getSenders().find(function(s) { return s.track && s.track.kind === 'audio'; });
    if (sender) sender.replaceTrack(newTrack);
    localStream.getAudioTracks().forEach(function(t) { t.stop(); localStream.removeTrack(t); });
    localStream.addTrack(newTrack);
  }).catch(function(err) {
    showToast('Mic switch failed: ' + err.message);
  });
}

function switchSpeaker(deviceId) {
  if (!deviceId) return;
  var el = document.getElementById('call-remote-audio');
  if (el && typeof el.setSinkId === 'function') {
    el.setSinkId(deviceId).catch(function(){});
  }
}

function initCallListeners() {
  if (!auth.currentUser) return;
  var myUid = auth.currentUser.uid;
  if (_incomingCallRef) _incomingCallRef.off();
  _incomingCallRef = db.ref('user-calls/' + myUid + '/incomingCall');
  _incomingCallRef.on('value', function(snap) {
    var data = snap.val();
    if (data && data.callId) {
      db.ref('calls/' + data.callId + '/status').once('value', function(statusSnap) {
        if (statusSnap.val() === 'ringing' && callState === 'IDLE') {
          incomingCall(data);
        }
      });
    }
  });
}

function initApp() {
  seedChannels();
  updateOnlineStatus();
  repairUserRecord();
  loadNicknames();
  initCallListeners();

  loadChannels();
  loadDMs();
  loadGroups();
  reportVersion();
  autoUpdateOnLaunch();
  applyUISettings();
  showReleaseNotes();
  if (window.__TAURI__) {
    window.__TAURI__.event.listen('before-quit', function() {
      if (currentCallId) { db.ref('calls/' + currentCallId + '/status').set('ended'); cleanupCall(); }
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
          var dmDisplayName = getFriendName(otherId, userData.displayName);
          var initial = dmDisplayName ? dmDisplayName.charAt(0).toUpperCase() : '?';
          var colour = userData.avatarColour || '#2d5da1';
          div.innerHTML = '<div class="avatar-wrap" onclick="event.stopPropagation();showUserOptions(\'' + otherId + '\')" style="cursor:pointer;"><span class="avatar avatar-sm" style="width:28px;height:28px;font-size:0.8rem;background:' + colour + ';">' + initial + '</span><span class="status-dot offline" id="dot-' + otherId + '"></span></div><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;" onclick="switchToDM(\'' + dmId + '\',\'' + otherId + '\')">' + dmDisplayName + '</span>';
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

          (function(div, key, otherId, otherName) {
            var del = document.createElement('button');
            del.className = 'dm-delete-btn';
            del.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12"/><path d="M5 4V2.5A.5.5 0 015.5 2h2a.5.5 0 01.5.5V4"/><path d="M12 4v9a1.5 1.5 0 01-1.5 1.5h-6A1.5 1.5 0 013 13V4"/></svg>';
            del.addEventListener('click', function(e) { e.stopPropagation(); deleteDM(key); });
            div.appendChild(del);
            // Real-time badge updates for future messages
            (function(k, oid, n) {
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
                  var title = getFriendName(oid, n);
                  if (m.ciphertext) {
                    decryptMsgInPlace(m, 'dm_' + k).then(function() {
                      notifyMessage(m, title);
                    });
                  } else {
                    notifyMessage(m, title);
                  }
                }
              });
            })(key, otherName);
          })(div, dmId, otherId, userData.displayName || 'Unknown');

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
  currentDmPeerId = null;
  currentGroupId = null;
  removeGroupMembersBtn();
  var callBtn = document.getElementById('dm-call-btn');
  if (callBtn) callBtn.style.display = 'none';
  document.getElementById('leaderboards-view').style.display = 'none';
  document.getElementById('games-grid').style.display = 'none';
  document.getElementById('message-list').style.display = '';

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
  currentDmPeerId = otherUserId;
  currentChannelId = null;
  currentGroupId = null;
  removeGroupMembersBtn();

  if (currentMsgQuery) { currentMsgQuery.off(); }

  localStorage.setItem('lastRead_' + dmId, Date.now());
  updateSidebarActive();
  var badgeEl = document.querySelector('#dm-list .sidebar-item[data-dm-id="' + dmId + '"] .unread-badge');
  if (badgeEl) badgeEl.remove();
  startTypingListener('dms/' + dmId);

  var callBtn = document.getElementById('dm-call-btn');
  if (callBtn) callBtn.style.display = 'inline-flex';
  document.getElementById('leaderboards-view').style.display = 'none';
  document.getElementById('games-grid').style.display = 'none';
  document.getElementById('message-list').style.display = '';

  db.ref('users/' + otherUserId).once('value').then(function(snapshot) {
    if (snapshot.exists()) {
      var name = getFriendName(otherUserId, snapshot.val().displayName) || 'Unknown';
      document.getElementById('current-channel-name').innerHTML = '<span>' + name + '</span>';
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
            notifyMessage(msg, getFriendName(msg.senderId, msg.senderName));
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
  } else {
    var gamesEl = document.getElementById('sidebar-games');
    if (gamesEl && document.getElementById('games-grid').style.display !== 'none') {
      gamesEl.classList.add('active');
    }
    var lbEl = document.getElementById('sidebar-leaderboards');
    if (lbEl && document.getElementById('leaderboards-view').style.display !== 'none') {
      lbEl.classList.add('active');
    }
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
      name.textContent = getFriendName(msg.senderId, msg.senderName);
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
      name.textContent = getFriendName(msg.senderId, msg.senderName);
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

  if (currentUser && currentUser.uid === ADMIN_UID) {
    row.style.cursor = 'context-menu';
    row.addEventListener('click', function(e) { showAdminModMenu(e, msg, row); });
  }
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

var _modMsg = null;
var _modRow = null;
var _modSenderId = null;
var _dismissHandler = null;

function showAdminModMenu(e, msg, row) {
  if (_dismissHandler) {
    document.removeEventListener('click', _dismissHandler);
    _dismissHandler = null;
  }
  _modMsg = msg;
  _modRow = row;
  _modSenderId = msg.senderId;
  var menu = document.getElementById('admin-moderation-menu');
  if (!menu) return;

  var x = Math.min(e.clientX, window.innerWidth - 190);
  var y = Math.min(e.clientY, window.innerHeight - 160);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.style.display = 'block';

  _dismissHandler = function() {
    _dismissAdminMod();
    document.removeEventListener('click', _dismissHandler);
    _dismissHandler = null;
  };
  setTimeout(function() {
    document.addEventListener('click', _dismissHandler);
  }, 10);
}

function _dismissAdminMod() {
  var menu = document.getElementById('admin-moderation-menu');
  if (menu) menu.style.display = 'none';
  _modMsg = null;
  _modRow = null;
}

function adminRemoveMessage(el) {
  var key = _modMsg && _modMsg._key;
  if (!key) { _dismissAdminMod(); return; }
  var path = getMsgPath(key);
  if (!path) { _dismissAdminMod(); return; }
  db.ref(path).update({
    text: 'This content was removed by the Scribble administration team. Keep it family friendly.',
    ciphertext: null,
    iv: null,
    imageData: null,
    imageURL: null,
    removedBy: currentUser.uid,
    removedAt: firebase.database.ServerValue.TIMESTAMP
  });
  showToast('Message removed by admin');
  _dismissAdminMod();
}

function adminKickUser(el) {
  if (!currentGroupId) { _dismissAdminMod(); showToast('Kick is only available in groups.'); return; }
  if (!_modSenderId) { _dismissAdminMod(); return; }
  var name = getFriendName(_modSenderId, _modMsg.senderName || 'Unknown');
  if (!confirm('Kick ' + name + ' from this group?')) { _dismissAdminMod(); return; }
  var updates = {};
  updates['groups/' + currentGroupId + '/members/' + _modSenderId] = null;
  updates['userGroups/' + _modSenderId + '/' + currentGroupId] = null;
  db.ref().update(updates);
  showToast('Kicked ' + name);
  _dismissAdminMod();
}

function adminBanUser(el) {
  if (!currentGroupId) { _dismissAdminMod(); showToast('Ban is only available in groups.'); return; }
  if (!_modSenderId) { _dismissAdminMod(); return; }
  var name = getFriendName(_modSenderId, _modMsg.senderName || 'Unknown');
  showBanDuration(currentGroupId, _modSenderId, name);
  _dismissAdminMod();
}

function replyToMessage(msg) {
  var input = document.getElementById('message-input');
  if (!input) return;
  var prefix = '@' + getFriendName(msg.senderId, msg.senderName || 'Unknown') + ': ' + (msg.text || '');
  input.value = prefix + (input.value ? ' ' + input.value : '');
  input.focus();
}

function copyMessage(msg, isOwn) {
  var text;
  if (isOwn) {
    text = msg.text || '';
  } else {
    text = getFriendName(msg.senderId, msg.senderName || 'Unknown') + ': ' + (msg.text || '');
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

// ===== SPAM PROTECTION =====

var spamTimestamps = [];
var spamTier = 0;
var spamCooldownUntil = 0;

function checkSpam(text) {
  var wordCount = text.trim().split(/\s+/).length;
  if (wordCount > 250) {
    showToast('Message too long (max 250 words)');
    return false;
  }
  var now = Date.now();
  if (now < spamCooldownUntil) {
    var secs = Math.ceil((spamCooldownUntil - now) / 1000);
    showToast('Slow down! Cooldown: ' + secs + 's');
    return false;
  }
  spamTimestamps = spamTimestamps.filter(function(t) { return now - t < 5000; });
  spamTimestamps.push(now);
  if (spamTimestamps.length >= 5) {
    spamTier = Math.min(spamTier + 1, 3);
    var durations = [0, 30000, 60000, 300000];
    spamCooldownUntil = now + durations[spamTier];
    spamTimestamps = [];
    showToast('Spam detected! Cooldown: ' + (durations[spamTier] / 1000) + 's');
    return false;
  }
  return true;
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

  // Spam protection
  if (!checkSpam(text)) { input.value = ''; return; }

  // Group ban check
  if (currentGroupId) {
    db.ref('groups/' + currentGroupId + '/banned/' + auth.currentUser.uid).once('value').then(function(snap) {
      if (snap.exists()) {
        var ban = snap.val();
        if (ban.expiresAt === 0 || ban.expiresAt > Date.now()) {
          showToast('You are banned from this group.');
          return;
        }
        // Expired ban - continue sending
        doSendMessage(text);
      } else {
        doSendMessage(text);
      }
    });
  } else {
    doSendMessage(text);
  }
}

function doSendMessage(text) {
  var input = document.getElementById('message-input');
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
    var body = getFriendName(msg.senderId, msg.senderName || "Someone") + ": " + (msg.text || (msg.imageData ? "Image" : (msg.ciphertext ? "Encrypted message" : "Image")));
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

function toggleFRList() {
  var list = document.getElementById('fr-list');
  var arrow = document.getElementById('fr-collapse-arrow');
  var collapsed = list.style.display === 'none';
  list.style.display = collapsed ? 'block' : 'none';
  if (arrow) arrow.classList.toggle('collapsed', !collapsed);
  localStorage.setItem('frCollapsed', collapsed ? '0' : '1');
}

function logoutFromSidebar() {
  auth.signOut().then(function() {
    window.location.href = 'signin.html';
  });
}

function openGameEmbed(url, title) {
  if (!url || url === 'about:blank') { showToast('Game URL not set yet'); return; }
  localStorage.setItem('ttt_display_name', myDisplayName);
  document.getElementById('game-embed-title').textContent = title || 'Game';
  document.getElementById('game-iframe').src = url + (url.indexOf('?') > -1 ? '&' : '?') + '_t=' + Date.now();
  document.getElementById('game-embed-modal').style.display = 'flex';
}

function closeGameEmbed() {
  document.getElementById('game-embed-modal').style.display = 'none';
  document.getElementById('game-iframe').src = 'about:blank';
}

function showGamesGrid() {
  currentChannelId = null;
  currentDmId = null;
  currentDmPeerId = null;
  currentGroupId = null;
  var callBtn = document.getElementById('dm-call-btn');
  if (callBtn) callBtn.style.display = 'none';
  if (currentMsgQuery) { currentMsgQuery.off(); currentMsgQuery = null; }
  if (currentTypingRef) { currentTypingRef.off(); currentTypingRef = null; }
  document.getElementById('leaderboards-view').style.display = 'none';
  document.getElementById('message-list').style.display = 'none';
  document.getElementById('games-grid').style.display = 'flex';
  document.getElementById('games-grid').style.flexDirection = 'column';
  document.getElementById('input-bar').style.display = 'none';
  document.getElementById('readonly-notice').style.display = 'none';
  document.getElementById('typing-indicator').style.display = 'none';
  document.getElementById('current-channel-name').innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><rect x="1.5" y="3" width="13" height="10" rx="2"/><circle cx="5" cy="8" r="1.5" fill="currentColor"/><path d="M9.5 6.5L11 8l-1.5 1.5"/><path d="M11.5 6.5L13 8l-1.5 1.5"/></svg> Games';
  document.getElementById('current-channel-name').onclick = null;
  removeGroupMembersBtn();
  updateSidebarActive();
}

function showLeaderboards() {
  currentChannelId = null;
  currentDmId = null;
  currentDmPeerId = null;
  currentGroupId = null;
  var callBtn = document.getElementById('dm-call-btn');
  if (callBtn) callBtn.style.display = 'none';
  if (currentMsgQuery) { currentMsgQuery.off(); currentMsgQuery = null; }
  if (currentTypingRef) { currentTypingRef.off(); currentTypingRef = null; }
  document.getElementById('games-grid').style.display = 'none';
  document.getElementById('message-list').style.display = 'none';
  document.getElementById('input-bar').style.display = 'none';
  document.getElementById('readonly-notice').style.display = 'none';
  document.getElementById('typing-indicator').style.display = 'none';
  document.getElementById('current-channel-name').innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><path d="M8 1l1.76 3.58 3.94.57-2.85 2.78.67 3.93L8 10.57l-3.52 1.85.67-3.93L2.3 5.15l3.94-.57z"/><path d="M4.5 12.5l-2 2.5"/><path d="M11.5 12.5l2 2.5"/></svg> Leaderboards';
  document.getElementById('current-channel-name').onclick = null;
  removeGroupMembersBtn();
  var lbView = document.getElementById('leaderboards-view');
  lbView.style.display = 'flex';
  lbView.style.flexDirection = 'column';
  renderLeaderboardTabs();
  updateSidebarActive();
}

var LB_GAMES = [
  { key: 'tic-tac-toe', label: 'Tic-Tac-Toe', icon: '❌' },
  { key: 'chess', label: 'Chess', icon: '♚' },
  { key: 'memory', label: 'Memory', icon: '🧠' },
  { key: 'trivia', label: 'Trivia', icon: '🧩' },
  { key: 'connect4', label: 'Connect 4', icon: '🔴' },
  { key: 'simon', label: 'Simon', icon: '🎵' },
  { key: 'snake', label: 'Snake', icon: '🐍', dbUrl: 'https://globalchat-eeb7a-default-rtdb.firebaseio.com' },
  { key: 'flappy-bird', label: 'Flappy Bird', icon: '🐦', dbUrl: 'https://flappy-bird-leaderbord-default-rtdb.firebaseio.com' }
];
var LB_PLACEHOLDER = [];
var LB_CACHE = {};
var LB_ACTIVE_TAB = null;

function renderLeaderboardTabs() {
  var tabsEl = document.getElementById('lb-tabs');
  var contentEl = document.getElementById('lb-content');
  if (!tabsEl) return;
  tabsEl.innerHTML = '';
  contentEl.innerHTML = '<div class="lb-loading">Loading...</div>';
  var allGames = LB_GAMES.concat(LB_PLACEHOLDER);
  allGames.forEach(function(g) {
    var tab = document.createElement('div');
    tab.className = 'lb-tab' + (LB_PLACEHOLDER.indexOf(g) !== -1 ? ' disabled' : '');
    tab.textContent = g.icon + ' ' + g.label;
    tab.dataset.key = g.key;
    if (!LB_GAMES.some(function(x) { return x.key === g.key; })) {
      tab.title = 'No leaderboard yet';
    }
    tab.onclick = function() {
      if (tab.classList.contains('disabled')) return;
      switchLeaderboardTab(this.dataset.key);
    };
    tabsEl.appendChild(tab);
  });
  if (LB_GAMES.length > 0) switchLeaderboardTab(LB_GAMES[0].key);
}

function switchLeaderboardTab(key) {
  var tabs = document.querySelectorAll('#lb-tabs .lb-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].dataset.key === key && !tabs[i].classList.contains('disabled')) {
      tabs[i].classList.add('active');
      break;
    }
  }
  LB_ACTIVE_TAB = key;
  var contentEl = document.getElementById('lb-content');
  contentEl.innerHTML = '<div class="lb-loading">Loading...</div>';
  var myName = (localStorage.getItem('ttt_display_name') || '').trim();
  if (LB_CACHE[key]) {
    renderLeaderboardTable(LB_CACHE[key], myName);
    return;
  }
  var game = null;
  for (var i = 0; i < LB_GAMES.length; i++) { if (LB_GAMES[i].key === key) { game = LB_GAMES[i]; break; } }
  var dbUrl = game && game.dbUrl ? game.dbUrl : 'https://telegram-a007d-default-rtdb.firebaseio.com';
  var auth = game && game.dbUrl ? '' : '?auth=VkAJSSFjEpCFAeDr6Sy1pDoAoBmxgOInoUoLUGc9';
  fetch(dbUrl + '/leaderboard.json' + auth)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var entries = [];
      if (data && typeof data === 'object') {
        for (var k in data) {
          var e = data[k];
          if (e) {
            var name = e.name || e.username || '';
            if (name) entries.push({ name: String(name).slice(0, 20), score: e.score || 0 });
          }
        }
        entries.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
      }
      LB_CACHE[key] = entries;
      renderLeaderboardTable(entries, myName);
    })
    .catch(function() {
      contentEl.innerHTML = '<div class="lb-error">Could not load scores. <button onclick="switchLeaderboardTab(\'' + key + '\')">Retry</button></div>';
    });
}

function renderLeaderboardTable(entries, myName) {
  var contentEl = document.getElementById('lb-content');
  if (!entries || entries.length === 0) {
    contentEl.innerHTML = '<div class="lb-empty">No scores yet — be the first by playing!</div>';
    return;
  }
  var html = '<table class="lb-table"><thead><tr><th class="rank">#</th><th class="name">Name</th><th class="score">Score</th></tr></thead><tbody>';
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
    var isMe = myName && e.name.toLowerCase() === myName.toLowerCase();
    html += '<tr' + (isMe ? ' class="me"' : '') + '><td class="rank">' + medal + '</td><td class="name">' + escHtml(e.name) + '</td><td class="score">' + (e.score || 0) + '</td></tr>';
  }
  html += '</tbody></table>';
  contentEl.innerHTML = html;
}
function escHtml(s) { return String(s).replace(/[&<>"]/g, function(m) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]; }); }

function renderLeaderboardTable(entries, myName) {
  var contentEl = document.getElementById('lb-content');
  if (!entries || entries.length === 0) {
    contentEl.innerHTML = '<div class="lb-empty">No scores yet — be the first by playing!</div>';
    return;
  }
  var html = '<table class="lb-table"><thead><tr><th class="rank">#</th><th class="name">Name</th><th class="score">Score</th></tr></thead><tbody>';
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
    var isMe = myName && e.name.toLowerCase() === myName.toLowerCase();
    html += '<tr' + (isMe ? ' class="me"' : '') + '><td class="rank">' + medal + '</td><td class="name">' + escHtml(e.name) + '</td><td class="score">' + (e.score || 0) + '</td></tr>';
  }
  html += '</tbody></table>';
  contentEl.innerHTML = html;
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

    var displayName = getFriendName(uid, userData.displayName);
    var initial = displayName ? displayName.charAt(0).toUpperCase() : '?';
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
      actionsHtml += '<button class="btn friend-btn" style="background:var(--color-accent);color:#fff;" onclick="startCall(\'' + uid + '\')">Call</button>';
      actionsHtml += '<button class="btn btn-secondary friend-btn" onclick="unfriend(\'' + uid + '\')">Unfriend</button>';
      actionsHtml += '<button class="btn btn-secondary friend-btn" onclick="blockUser(\'' + uid + '\')">Block</button>';
    } else {
      actionsHtml = '<button class="btn friend-btn" onclick="sendFriendRequest(\'' + uid + '\')">Send Friend Request</button>';
      actionsHtml += '<button class="btn btn-secondary friend-btn" onclick="blockUser(\'' + uid + '\')">Block</button>';
    }

    actionsHtml += '<button class="btn btn-secondary friend-btn" onclick="shareProfile(\'' + uid + '\')">Share Profile</button>';

    var msgCountHtml = '<div class="profile-stats"><div class="stat"><div class="num" id="pcard-msgs">...</div><div class="label">messages</div></div><div class="stat"><div class="num">' + followingCount + '</div><div class="label">following</div></div><div class="stat"><div class="num">' + followerCount + '</div><div class="label">followers</div></div></div>';

    var pencilSvg = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z"/></svg>';
    profileCard.innerHTML =
      '<div class="avatar avatar-lg avatar-fallback" style="background:' + avatarColour + ';width:64px;height:64px;font-size:1.8rem;margin-bottom:8px;">' + initial + '</div>' +
      '<div style="display:flex;align-items:center;justify-content:center;gap:6px;"><h3 style="margin:0;">' + displayName + '</h3><span style="cursor:pointer;opacity:0.4;transition:opacity 0.15s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.4" onclick="renameFriend(\'' + uid + '\')">' + pencilSvg + '</span></div>' +
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

    var optionsDisplayName = getFriendName(uid, userData.displayName);
    var initial = (optionsDisplayName || '?').charAt(0).toUpperCase();
    var colour = userData.avatarColour || '#2d5da1';

    header.innerHTML = '<div class="uoptions-avatar" style="background:' + colour + ';">' + initial + '</div><div class="uoptions-name">' + optionsDisplayName + '</div>';

    var html = '';
    var isFriend = (myReq && myReq.status === 'accepted') || (theirReq && theirReq.status === 'accepted');

    // Call button
    html += '<button class="btn uoptions-btn" onclick="callFromOptions()"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 11.5c-2.5 2-5.5 3-8.5 3s-6-1-8.5-3a1 1 0 01-.3-1l1.5-2a1 1 0 011-.5l2 .5a1 1 0 01.6.7l.5 1.5"/><path d="M11.7 9.2l.5-1.5a1 1 0 01.6-.7l2-.5a1 1 0 011 .5l1.5 2a1 1 0 01-.3 1"/></svg> Call</button>';

    // Rename button
    html += '<button class="btn btn-secondary uoptions-btn" onclick="renameFromOptions()"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z"/></svg> Rename</button>';

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
    html += '<button class="btn btn-secondary uoptions-btn" onclick="toggleAddToGroupList()"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a2 2 0 100-4 2 2 0 000 4z"/><path d="M2 14v-1a3 3 0 013-3h2a3 3 0 013 3v1"/><path d="M10 6h4M12 4v4"/></svg> Add to Group <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-left:auto;"><path d="M6 4l4 4-4 4"/></svg></button>';
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

function callFromOptions() {
  var uid = _userOptionsUid;
  if (!uid) return;
  hideUserOptions();
  startCall(uid);
}

function renameFromOptions() {
  var uid = _userOptionsUid;
  if (!uid) return;
  hideUserOptions();
  renameFriend(uid);
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
    creator: myUid,
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
  currentDmPeerId = null;
  var callBtn = document.getElementById('dm-call-btn');
  if (callBtn) callBtn.style.display = 'none';
  document.getElementById('leaderboards-view').style.display = 'none';
  document.getElementById('games-grid').style.display = 'none';
  document.getElementById('message-list').style.display = '';

  if (currentMsgQuery) { currentMsgQuery.off(); }

  localStorage.setItem('lastRead_' + groupId, Date.now());
  updateSidebarActive();
  var badgeEl = document.querySelector('#group-list .sidebar-item[data-group-id="' + groupId + '"] .unread-badge');
  if (badgeEl) badgeEl.remove();
  startTypingListener('groups/' + groupId);

  var groupConvPath = 'group_' + groupId;
  var groupName = 'Group';
  var myUid = auth.currentUser.uid;

  db.ref('groups/' + groupId).once('value').then(function(snapshot) {
    if (snapshot.exists()) {
      var data = snapshot.val();
      groupName = data.name || 'Group';
      var code = data.joinCode;
      var isAdmin = (data.creator === myUid || myUid === ADMIN_UID);
      var memberCount = data.members ? Object.keys(data.members).length : 0;

      var headerHtml = groupIcon + ' ' + groupName + (code ? ' <span style="font-size:0.8rem;opacity:0.6;margin-left:8px;">Code: ' + code + '</span>' : '');
      document.getElementById('current-channel-name').innerHTML = headerHtml;

      // Add members button outside current-channel-name to avoid click bubbling with showChatStats
      var membersBtnId = 'gm-btn-' + groupId.replace(/[^a-zA-Z0-9]/g, '_');
      var existing = document.getElementById(membersBtnId);
      if (existing) existing.remove();
      var membersBtn = document.createElement('button');
      membersBtn.id = membersBtnId;
      membersBtn.className = 'btn btn-secondary';
      membersBtn.style.cssText = 'padding:2px 20px;font-size:0.7rem;min-height:auto;vertical-align:middle;';
      membersBtn.textContent = memberCount + ' members';
      membersBtn.onclick = function(e) { e.stopPropagation(); showGroupMembers(groupId); };
      var nameContainer = document.getElementById('current-channel-name').parentNode;
      if (isAdmin) {
        nameContainer.parentNode.insertBefore(membersBtn, nameContainer.nextSibling);
      }

      // Check if current user is banned
      var bannedMap = data.banned || {};
      var banInfo = bannedMap[myUid];
      if (banInfo) {
        var banActive = false;
        if (banInfo.expiresAt === 0) {
          banActive = true;
        } else if (banInfo.expiresAt > Date.now()) {
          banActive = true;
        }
        if (banActive) {
          var msgList = document.getElementById('message-list');
          msgList.innerHTML = '<p class="text-center" style="padding:40px;color:var(--color-accent);">You are banned from this group.</p>';
          document.getElementById('input-bar').style.display = 'none';
          if (currentMsgQuery) { currentMsgQuery.off(); }
          return;
        }
      }
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
    creator: myUid,
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
        resolved.push(getFriendName(id, snap.val() || 'Someone'));
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
        return { id: id, name: getFriendName(id, snap.val() || 'Unknown'), count: counts[id] };
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

// ===== GROUP MEMBERS, KICK, BAN =====

function removeGroupMembersBtn() {
  var all = document.querySelectorAll('[id^="gm-btn-"]');
  all.forEach(function(el) { el.remove(); });
}

var _gmGroupId = null;
var _gmTargetUid = null;
var _gmTargetName = '';

function showGroupMembers(groupId) {
  _gmGroupId = groupId;
  var myUid = auth.currentUser.uid;
  var title = document.getElementById('group-members-title');
  var list = document.getElementById('group-members-list');
  list.innerHTML = '<p style="text-align:center;color:rgba(45,45,45,0.4);padding:20px;">Loading...</p>';
  document.getElementById('group-members-modal').style.display = 'flex';

  db.ref('groups/' + groupId).once('value').then(function(snap) {
    var grp = snap.val();
    if (!grp || !grp.members) { list.innerHTML = '<p style="text-align:center;color:rgba(45,45,45,0.4);padding:20px;">Group not found.</p>'; return; }
    var isAdmin = (grp.creator === myUid || myUid === ADMIN_UID);
    title.textContent = 'Members (' + Object.keys(grp.members).length + ')';

    var bannedMap = grp.banned || {};
    var uidList = Object.keys(grp.members);
    var pendingNames = uidList.map(function(uid) {
      return db.ref('users/' + uid).once('value').then(function(userSnap) {
        var user = userSnap.val();
        var name = getFriendName(uid, user ? user.displayName : null);
        var colour = user ? (user.avatarColour || '#2d5da1') : '#2d5da1';
        return { uid: uid, name: name, colour: colour };
      });
    });

    Promise.all(pendingNames).then(function(users) {
      var html = '';
      users.forEach(function(u) {
        var initial = u.name.charAt(0).toUpperCase();
        var isCreator = (u.uid === grp.creator);
        var isBanned = bannedMap[u.uid];
        var bannedExpires = isBanned ? isBanned.expiresAt : null;
        var bannedLabel = '';
        if (isBanned) {
          if (bannedExpires && bannedExpires !== 0) {
            var remaining = Math.ceil((bannedExpires - Date.now()) / 1000);
            if (remaining > 0) bannedLabel = '<span style="color:var(--color-accent);font-size:0.75rem;"> (banned ' + Math.ceil(remaining / 60) + 'm)</span>';
            else bannedLabel = '<span style="color:var(--color-accent);font-size:0.75rem;"> (banned)</span>';
          } else {
            bannedLabel = '<span style="color:var(--color-accent);font-size:0.75rem;"> (banned)</span>';
          }
        }

        html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--color-border);">';
        html += '<span class="avatar avatar-sm" style="width:28px;height:28px;font-size:0.75rem;background:' + u.colour + ';flex-shrink:0;">' + initial + '</span>';
        html += '<span style="flex:1;">' + u.name + (isCreator ? ' <span style="font-size:0.7rem;opacity:0.5;">(creator)</span>' : '') + '</span>' + bannedLabel;

        if (isAdmin && !isCreator) {
          if (isBanned) {
            html += '<button class="btn btn-secondary" style="padding:2px 10px;font-size:0.75rem;min-height:auto;" onclick="unbanMember(\'' + groupId + '\',\'' + u.uid + '\')">Unban</button>';
          } else {
            html += '<button class="btn btn-secondary" style="padding:2px 10px;font-size:0.75rem;min-height:auto;margin-right:4px;" onclick="showKickConfirm(\'' + groupId + '\',\'' + u.uid + '\',\'' + u.name.replace(/'/g, "\\'") + '\')">Kick</button>';
            html += '<button class="btn btn-danger" style="padding:2px 10px;font-size:0.75rem;min-height:auto;" onclick="showBanDuration(\'' + groupId + '\',\'' + u.uid + '\',\'' + u.name.replace(/'/g, "\\'") + '\')">Ban</button>';
          }
        }
        html += '</div>';
      });
      list.innerHTML = html;
    });
  });
}

function showKickConfirm(groupId, uid, name) {
  if (confirm('Kick "' + name + '" from this group?')) {
    kickMember(groupId, uid);
  }
}

function kickMember(groupId, uid) {
  var myUid = auth.currentUser.uid;
  db.ref('groups/' + groupId).once('value').then(function(snap) {
    var grp = snap.val();
    if (!grp) return;
    if (grp.creator !== myUid && myUid !== ADMIN_UID) { showToast('Only the group creator can kick members.'); return; }
    if (uid === grp.creator) { showToast('Cannot kick the group creator.'); return; }
    var updates = {};
    updates['groups/' + groupId + '/members/' + uid] = null;
    updates['userGroups/' + uid + '/' + groupId] = null;
    db.ref().update(updates).then(function() {
      showToast('Member kicked.');
      showGroupMembers(groupId);
    });
  });
}

var _banGroupId = null;
var _banTargetUid = null;

function showBanDuration(groupId, uid, name) {
  _banGroupId = groupId;
  _banTargetUid = uid;
  document.getElementById('ban-duration-name').textContent = 'Ban ' + name + ' for:';
  document.getElementById('ban-duration-modal').style.display = 'flex';
}

function confirmBan(durationMs) {
  var groupId = _banGroupId;
  var uid = _banTargetUid;
  var myUid = auth.currentUser.uid;
  if (!groupId || !uid) return;

  db.ref('groups/' + groupId).once('value').then(function(snap) {
    var grp = snap.val();
    if (!grp) return;
    if (grp.creator !== myUid && myUid !== ADMIN_UID) { showToast('Only the group creator can ban members.'); return; }
    if (uid === grp.creator) { showToast('Cannot ban the group creator.'); return; }

    var expiresAt = durationMs === 0 ? 0 : Date.now() + durationMs;
    var updates = {};
    updates['groups/' + groupId + '/banned/' + uid] = {
      bannedBy: myUid,
      expiresAt: expiresAt,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    };
    updates['groups/' + groupId + '/members/' + uid] = null;
    updates['userGroups/' + uid + '/' + groupId] = null;
    db.ref().update(updates).then(function() {
      document.getElementById('ban-duration-modal').style.display = 'none';
      showToast('Member banned.');
      showGroupMembers(groupId);
    });
  });
}

function unbanMember(groupId, uid) {
  db.ref('groups/' + groupId).once('value').then(function(snap) {
    var grp = snap.val();
    if (!grp) return;
    var myUid = auth.currentUser.uid;
    if (grp.creator !== myUid && myUid !== ADMIN_UID) { showToast('Only the group creator can unban members.'); return; }
    var updates = {};
    updates['groups/' + groupId + '/banned/' + uid] = null;
    db.ref().update(updates).then(function() {
      showToast('Member unbanned.');
      showGroupMembers(groupId);
    });
  });
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

  if (localStorage.getItem('frCollapsed') === '1') {
    var frList = document.getElementById('fr-list');
    var frArrow = document.getElementById('fr-collapse-arrow');
    if (frList) frList.style.display = 'none';
    if (frArrow) frArrow.classList.add('collapsed');
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
    '<button id="update-dismiss-btn" style="background:none;border:none;cursor:pointer;padding:4px 8px;color:inherit;"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l10 10"/><path d="M13 3L3 13"/></svg></button>';
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

function autoUpdateOnLaunch() {
  if (!window.__TAURI__) return;
  window.__TAURI__.app.getVersion().then(function(myVersion) {
    // Check if we just updated
    var preVersion = localStorage.getItem('scribble_preVersion');
    if (preVersion && preVersion !== myVersion) {
      localStorage.removeItem('scribble_preVersion');
      showUpdateCompleteModal(preVersion, myVersion);
      return;
    }
    // Check for pending update
    db.ref('appVersion').once('value').then(function(snapshot) {
      var data = snapshot.val();
      if (!data || !data.latest || !data.downloadUrl) return;
      if (isNewerVersion(myVersion, data.latest)) {
        localStorage.setItem('scribble_preVersion', myVersion);
        window.__TAURI__.core.invoke('auto_install', { url: data.downloadUrl }).then(function() {
          window.__TAURI__.core.invoke('quit_app');
        }).catch(function(err) {
          console.error('Auto-update failed:', err);
          localStorage.removeItem('scribble_preVersion');
          showUpdateBanner(data.latest, data.downloadUrl);
        });
      }
    });
  });
}

function showUpdateCompleteModal(oldVersion, newVersion) {
  var safeKey = newVersion.replace(/\./g, '_');
  db.ref('appVersion/releases/' + safeKey + '/notes').once('value').then(function(snap) {
    var notes = snap.val() || 'See announcements for details.';
    document.getElementById('release-notes-version').textContent = 'Updated to v' + newVersion;
    document.getElementById('release-notes-body').textContent = notes;
    document.getElementById('release-notes-modal').style.display = 'flex';
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
