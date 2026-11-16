// CHRONICLE OF BETRAYAL — net.js: オンライン対戦 (PeerJS)


// --- v5 追加: オンライン対戦（PeerJS・ホスト権威方式） ---
const NET_PREFIX = 'cob-v9-';
const NET_ACTION_WHITELIST = ['actionEnlist', 'actionDomesticAffairs', 'actionTrain', 'actionRelocate', 'actionBribeSabotage', 'actionResign', 'actionRecruit', 'actionDistributeFunds', 'actionEmbezzle', 'actionLaunchAttack', 'actionSetFactionPolicy', 'actionStrategyDomestic', 'actionStrategyTrain', 'actionEmergencyLevy', 'actionChangeTroopType'];
const NET_ACTION_PHASE = {
    actionEnlist: 'PERSONAL', actionDomesticAffairs: 'PERSONAL', actionTrain: 'PERSONAL',
    actionRelocate: 'PERSONAL', actionBribeSabotage: 'PERSONAL', actionResign: 'PERSONAL', actionChangeTroopType: 'PERSONAL',
    actionRecruit: 'STRATEGY', actionDistributeFunds: 'STRATEGY', actionEmbezzle: 'STRATEGY',
    actionSetFactionPolicy: 'STRATEGY', actionStrategyDomestic: 'STRATEGY', actionStrategyTrain: 'STRATEGY', actionLaunchAttack: null
};
let netPeer = null;
let netHostConn = null;
let netMyOfficerId = null;
let netGuestByOfficer = {};
let netPendingConns = [];
let netStatusText = '未接続';

function netSetStatus(text) {
    netStatusText = text;
    const el = document.getElementById('net-status');
    if (el) el.textContent = text;
}

function openNetModal() {
    document.getElementById('net-overlay').classList.remove('hidden');
    netSetStatus(netStatusText);
    updateNetPanel();
}
function closeNetModal() { document.getElementById('net-overlay').classList.add('hidden'); }

function updateNetPanel() {
    const skip = document.getElementById('net-skip');
    if (!skip) return;
    let show = false;
    if (gameState.netMode === 'host' && gameState.pendingPhase) {
        const o = gameState.officers.find(x => x.id === gameState.pendingPhase.officerId);
        if (o && o.control === 'remote') show = true;
    }
    skip.classList.toggle('hidden', !show);
}

function netSnapshot() {
    return {
        day: gameState.day,
        selectedCastleId: gameState.selectedCastleId,
        unifiedAchieved: gameState.unifiedAchieved,
        endlessMode: gameState.endlessMode,
        castles: gameState.castles,
        officers: gameState.officers,
        armies: gameState.armies,
        terrainIds: gameState.mapGrid.map(row => row.map(c => c.terrain.id)),
        territoryIds: gameState.territory,
        developmentIds: gameState.development,
        factions: FACTIONS,
        nextFactionId,
        humans: gameState.humans,
        setupDone: gameState.setupDone,
        pendingPhase: gameState.pendingPhase,
        pendingRebellion: gameState.pendingRebellion,
        chronicle: gameState.chronicle,
        mapSize: gameState.mapSize,
        mapCols: MAP_COLS,
        mapRows: MAP_ROWS,
        activePhase: gameState.activePhase,
        activeOfficerId: gameState.activeOfficerId,
        logLines: gameState.logLines,
        statusByOfficer: gameState._statusByOfficer
    };
}

function netSync() {
    if (gameState.netMode !== 'host') return;
    const snap = netSnapshot();
    Object.values(netGuestByOfficer).forEach(c => { try { c.send({ type: 'state', data: snap }); } catch (e) { /* noop */ } });
    updateNetPanel();
}

function netBroadcast(obj) {
    if (gameState.netMode !== 'host') return;
    Object.values(netGuestByOfficer).forEach(c => { try { c.send(obj); } catch (e) { /* noop */ } });
}

function rebuildLogDOM() {
    const logEl = document.getElementById('event-log');
    if (!logEl) return;
    const colors = { info: 'text-slate-300', good: 'text-emerald-400', warn: 'text-amber-400', danger: 'text-rose-400 font-bold', phase: 'text-sky-400 font-bold' };
    logEl.innerHTML = '';
    gameState.logLines.forEach(line => {
        const entry = document.createElement('div');
        entry.className = `${colors[line.kind] || colors.info} leading-snug`;
        entry.textContent = `[${line.day}日] ${line.text}`;
        logEl.appendChild(entry);
    });
}

function netApplySnapshot(d) {
    if (d.mapCols && d.mapRows) { MAP_COLS = d.mapCols; MAP_ROWS = d.mapRows; }
    if (d.mapSize) gameState.mapSize = d.mapSize;
    const terrainById = {};
    Object.values(TERRAIN).forEach(t => { terrainById[t.id] = t; });
    gameState.day = d.day;
    gameState.selectedCastleId = d.selectedCastleId;
    gameState.unifiedAchieved = d.unifiedAchieved;
    gameState.endlessMode = d.endlessMode;
    gameState.castles = d.castles;
    gameState.officers = d.officers;
    gameState.armies = d.armies || [];
    gameState.mapGrid = (d.terrainIds || []).map((row, r) => row.map((tid, q) => ({ q, r, terrain: terrainById[tid] || TERRAIN.PLAIN })));
    gameState.territory = (Array.isArray(d.territoryIds) && d.territoryIds.length) ? d.territoryIds : gameState.territory;
    gameState.development = (Array.isArray(d.developmentIds) && d.developmentIds.length) ? d.developmentIds : gameState.development;
    Object.keys(FACTIONS).forEach(k => delete FACTIONS[k]);
    Object.assign(FACTIONS, d.factions || {});
    nextFactionId = d.nextFactionId || (d.mapSize === 'large' ? 8 : 6);
    gameState.humans = d.humans || [];
    gameState.setupDone = true;
    gameState._statusByOfficer = d.statusByOfficer || {};
    gameState.logLines = d.logLines || [];
    const mine = d.activeOfficerId === netMyOfficerId;
    gameState.activePhase = mine ? d.activePhase : null;
    gameState.activeOfficerId = mine ? d.activeOfficerId : null;
    gameState.pendingPhase = d.pendingPhase || null;
    gameState.pendingRebellion = d.pendingRebellion || null;
    gameState.chronicle = Array.isArray(d.chronicle) ? d.chronicle : gameState.chronicle;
    gameState.selectedTile = null;
    gameState.viewOfficerId = netMyOfficerId;
    document.getElementById('setup-overlay').classList.add('hidden');
    if (gameState.endlessMode) document.getElementById('endless-banner').classList.remove('hidden');
    rebuildLogDOM();
    const hov = document.getElementById('handover-overlay');
    if (gameState.pendingPhase && gameState.pendingPhase.officerId === netMyOfficerId) { showHandover(); }
    else { hov.classList.add('hidden'); }
    updateUI();
    drawMap();
    if (gameState.pendingRebellion) promptRebellionDecision();
}

function netClaimSlot(conn) {
    const slot = gameState.officers.find(o => isHuman(o) && o.control === 'remote' && !netGuestByOfficer[o.id]);
    if (!slot) return false;
    netGuestByOfficer[slot.id] = conn;
    conn.__officerId = slot.id;
    conn.send({ type: 'welcome', officerId: slot.id });
    netSync();
    netSetStatus(`${slot.name} がオンライン参加しました。`);
    showEventNotice('オンライン参加', `${slot.name} が接続しました。`, 'info', {});
    return true;
}

function netProcessPending() {
    if (gameState.netMode !== 'host') return;
    const pending = netPendingConns.slice();
    netPendingConns = [];
    pending.forEach(c => { if (!netClaimSlot(c)) { try { c.send({ type: 'full' }); } catch (e) { /* noop */ } } });
}

function netSetupHostConn(conn) {
    netWatchIce(conn);
    conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'hello') {
            if (conn.__officerId) return;
            if (!netClaimSlot(conn)) {
                if (!gameState.setupDone) { netPendingConns.push(conn); netSetStatus('参加者が接続しました。セットアップ完了後に割り当てます。'); }
                else { try { conn.send({ type: 'full' }); } catch (e) { /* noop */ } }
            }
            return;
        }
        if (conn.__officerId) netHandleGuestData(conn.__officerId, msg);
    });
    conn.on('close', () => {
        if (conn.__officerId) { delete netGuestByOfficer[conn.__officerId]; netSetStatus('オンライン参加者が切断しました。'); }
        netPendingConns = netPendingConns.filter(c => c !== conn);
    });
}

function netHandleGuestData(officerId, msg) {
    // v7 review fix: any message from the watched remote player resets the AFK deadline (no forced skip mid-play)
    if (netAfkKey && (netAfkKey === 'P:' + officerId || netAfkKey === 'A:' + officerId)) netAfkDeadline = Date.now() + NET_AFK_LIMIT_MS;
    if (msg.type === 'begin') {
        if (gameState.pendingPhase && gameState.pendingPhase.officerId === officerId) beginHumanPhase();
    } else if (msg.type === 'finish') {
        // v7: ゲスト本人のフェイズ終了だけを受け付ける
        if (gameState.activeOfficerId === officerId && gameState.activePhase) finishPlayerPhase();
    } else if (msg.type === 'rebellion-decision') {
        // v8: 決起判断は保留中の筆頭本人からのみ受け付ける
        if (gameState.pendingRebellion && gameState.pendingRebellion.leaderId === officerId) {
            applyRebellionDecision(!!msg.accept);
        }
    } else if (msg.type === 'forced-march') {
        // v8: 強行軍は出撃元城主本人のみ（支払いも本人）
        const army = gameState.armies.find(a => a.id === msg.armyId);
        const sender = gameState.officers.find(o => o.id === officerId);
        if (army && sender && canForceMarch(army, sender) && spendCommand(sender, COMMAND_COSTS.forcedMarch)) {
            army.forcedUntil = gameState.day + 3;
            const cmd = gameState.officers.find(o => o.id === army.commanderId);
            addLog(`${cmd ? cmd.name : '部隊'} 隊が強行軍を開始しました（3日間、移動力+2）。`, 'good');
            saveGame(); netSync(); updateUI(); drawMap();
        }
    } else if (msg.type === 'develop') {
        // v8: 領地開発は自勢力領地の城主本人のみ。座標は整数に直してから検証する（文字列座標で城マス判定をすり抜けるのを防ぐ）
        const sender = gameState.officers.find(o => o.id === officerId);
        const kind = (msg.kind === 1 || msg.kind === 2) ? msg.kind : 0;
        const q = Number(msg.q), r = Number(msg.r);
        if (sender && kind && Number.isInteger(q) && Number.isInteger(r) && canDevelopTile(sender, q, r)) {
            const castle = gameState.castles.find(c => c.id === sender.castleId);
            const goldCost = DEVELOP_COSTS[kind] || 0;
            if (castle && castle.treasury >= goldCost && spendCommand(sender, COMMAND_COSTS.develop)) {
                castle.treasury -= goldCost;
                setDevelopment(q, r, kind);
                addLog(`${castle.name}の領地 (${q}, ${r}) に${kind === 1 ? '農地' : '関所'}を開発しました。`, 'good');
                saveGame(); netSync(); updateUI(); drawMap();
            }
        }
    } else if (msg.type === 'order') {
        // v7: ゲストからの部隊指示（指揮官本人か、出撃元の城主のみ許可）
        const army = gameState.armies.find(a => a.id === msg.armyId);
        const sender = gameState.officers.find(o => o.id === officerId);
        if (army && sender && canOrderArmy(army, sender) && (msg.kind === 'WAIT' || msg.kind === 'RETURN' || msg.kind === 'ADVANCE')) {
            if (setArmyOrder(army, msg.kind, msg.targetCastleId)) { saveGame(); netSync(); }
        }
    } else if (msg.type === 'action') {
        if (!NET_ACTION_WHITELIST.includes(msg.name)) return;
        if (gameState.activeOfficerId !== officerId) return;
        const args = Array.isArray(msg.args) ? msg.args.slice(0, 6) : []; // v9 review fix: 6番目の引数（部隊方針）まで通す
        if (args.some(a => a !== null && typeof a === 'object')) return;
        const need = NET_ACTION_PHASE[msg.name];
        if (need && gameState.activePhase !== need) return;
        if (msg.name === 'actionLaunchAttack') {
            const mode = args[3] || 'strategy';
            if (mode !== 'strategy' && mode !== 'independent') return;
            if (mode === 'strategy' && gameState.activePhase !== 'STRATEGY') return;
            if (mode === 'independent' && gameState.activePhase !== 'PERSONAL') return;
        }
        if (msg.name === 'actionLaunchAttack' && args.length > 4 && args[4] !== null && typeof args[4] !== 'number') return;
        if (msg.name === 'actionLaunchAttack' && args.length > 5 && args[5] !== null && typeof args[5] !== 'string') return; // v9: 方針は文字列か null のみ
        const fn = window[msg.name];
        if (typeof fn === 'function') {
            try { fn(...args); } catch (e) { addLog('オンライン参加者の操作でエラーが発生しました。', 'warn'); }
            netSync();
        }
    }
}

// v8: ICE設定。STUNに加えて公開リレー（Metered Open Relay）を入れ、つながりにくい回線同士でも中継で結ぶ。
// 強制中継モードは端末ごとの設定（localStorage）で切り替える。公開リレーは無料枠のため、混雑時はつながりにくいことがある。
function netRelayOnly() {
    try { return localStorage.getItem('cob-relay-only') === '1'; } catch (e) { return false; }
}
function netIceConfig() {
    const cfg = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }
        ]
    };
    if (netRelayOnly()) cfg.iceTransportPolicy = 'relay';
    return cfg;
}
function netWatchIce(conn) {
    if (!conn || typeof conn.on !== 'function') return;
    conn.on('iceStateChanged', (state) => {
        if (state === 'disconnected') netSetStatus('接続が不安定です（相手の画面が止まっている可能性があります）。');
        else if (state === 'failed') netSetStatus('接続に失敗しました。強制中継モードを試すか、回線を変えて再接続してください。');
        else if (state === 'connected' || state === 'completed') updateNetPanel();
    });
}

function netCreateRoom() {
    if (typeof Peer === 'undefined') { netSetStatus('オンライン機能を読み込めませんでした。ネット接続のある環境で開いてください。'); return; }
    if (netPeer) { netSetStatus('すでにルームを作成しています。参加コード: ' + gameState.netCode); return; }
    const code = Math.random().toString(36).slice(2, 10).toUpperCase();
    netPeer = new Peer(NET_PREFIX + code, { config: netIceConfig() });
    netPeer.on('open', () => {
        gameState.netMode = 'host';
        gameState.netCode = code;
        const humans = gameState.officers.filter(o => isHuman(o));
        if (gameState.setupDone && humans.length && humans.every(o => !o.control)) {
            humans.forEach((o, i) => { o.control = i === 0 ? 'local' : 'remote'; });
        }
        netSetStatus(`ルームを作成しました。参加コード: ${code} を相手に伝えてください。`);
        updateNetPanel();
        updateUI();
        netStartAfkWatchdog();
        if (gameState.setupDone) netEnableOnlineAuto();
        if (!gameState.setupDone) { closeNetModal(); showSetup(); }
    });
    netPeer.on('connection', (conn) => netSetupHostConn(conn));
    netPeer.on('error', (err) => netSetStatus('接続エラー: ' + (err && err.type ? err.type : 'unknown')));
}

function netJoinRoom() {
    const input = document.getElementById('net-code-input');
    const code = ((input && input.value) || '').trim().toUpperCase();
    if (!code) { netSetStatus('参加コードを入力してください。'); return; }
    if (typeof Peer === 'undefined') { netSetStatus('オンライン機能を読み込めませんでした。ネット接続のある環境で開いてください。'); return; }
    if (netPeer) return;
    netPeer = new Peer(undefined, { config: netIceConfig() });
    netPeer.on('open', () => {
        netHostConn = netPeer.connect(NET_PREFIX + code, { reliable: true });
        netWatchIce(netHostConn);
        netHostConn.on('open', () => { netHostConn.send({ type: 'hello' }); netSetStatus('ホストに接続しました。参加枠の割り当てを待っています…'); });
        netHostConn.on('data', (msg) => {
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'welcome') {
                netMyOfficerId = msg.officerId;
                gameState.netMode = 'guest';
                document.body.classList.add('net-guest');
                document.getElementById('setup-overlay').classList.add('hidden');
                closeNetModal();
                netSetStatus('参加しました。ホストの進行に同期しています。');
            } else if (msg.type === 'state') {
                if (gameState.netMode === 'guest') netApplySnapshot(msg.data);
            } else if (msg.type === 'notice') {
                showEventNotice(msg.title, msg.body, msg.kind, msg.opts || {});
            } else if (msg.type === 'full') {
                netSetStatus('参加枠が空いていませんでした（リモート枠が満員）。');
            }
        });
        netHostConn.on('close', () => netSetStatus('ホストとの接続が切れました。'));
    });
    netPeer.on('error', (err) => netSetStatus('接続エラー: ' + (err && err.type === 'peer-unavailable' ? 'そのコードのルームが見つかりません' : ((err && err.type) || 'unknown'))));
}

function netGuestGate(name, args) {
    if (gameState.netMode !== 'guest') return false;
    let sent = false;
    if (netHostConn && netHostConn.open !== false) {
        try { netHostConn.send({ type: 'action', name, args }); sent = true; } catch (e) { /* noop */ }
    }
    if (!sent) {
        netSetStatus('ホストに接続できていません。操作は送信されませんでした。');
        showEventNotice('接続エラー', 'ホストに接続できていません。操作は送信されませんでした。', 'danger', {});
    }
    return true;
}

function netSkipRemotePhase() {
    if (gameState.netMode !== 'host') return;
    const p = gameState.pendingPhase;
    if (!p) return;
    const o = gameState.officers.find(x => x.id === p.officerId);
    if (!o || o.control !== 'remote') return;
    gameState.pendingPhase = null;
    document.getElementById('handover-overlay').classList.add('hidden');
    addLog(`${o.name} のフェイズをスキップしました（オンライン）。`, 'warn');
    netSync();
    startAutoTimer();
    updateUI();
    updateNetPanel();
}

// v7: リモート参加者のフェイズが進行中かどうか（ホストはその間、閲覧のみ）
function isHostRemoteLock() {
    if (gameState.netMode !== 'host') return false;
    if (!gameState.activePhase || !gameState.activeOfficerId) return false;
    const o = gameState.officers.find(x => x.id === gameState.activeOfficerId);
    return !!(o && o.control === 'remote');
}

// v7: オンラインホスト中は世界を自動進行させる（止まるのは人間のフェイズの間だけ）
function netEnableOnlineAuto() {
    if (gameState.netMode !== 'host') return;
    gameState.autoPlay = true;
    gameState.autoHalted = false;
    updateAutoButton();
    startAutoTimer();
}

// v7: リモートフェイズの放置対策（120秒で自動スキップ）
let netAfkTimer = null;
let netAfkKey = null;
let netAfkDeadline = 0;
const NET_AFK_LIMIT_MS = 120000;

function netStartAfkWatchdog() {
    if (netAfkTimer) return;
    netAfkTimer = setInterval(netAfkTick, 1000);
}

function netAfkTick() {
    try {
        if (gameState.netMode !== 'host') { netAfkKey = null; return; }
        // v8 review fix: 決起判断の保留が制限時間を過ぎたら自動で思いとどまる扱いにする
        if (gameState.pendingRebellion && gameState.pendingRebellion.deadline && Date.now() > gameState.pendingRebellion.deadline) {
            addLog('決起の判断が制限時間内に届かなかったため、機は逸しました。', 'warn');
            applyRebellionDecision(false);
        }
        let key = null;
        let officer = null;
        let isPending = false;
        if (gameState.pendingPhase) {
            const o = gameState.officers.find(x => x.id === gameState.pendingPhase.officerId);
            if (o && o.control === 'remote') { key = 'P:' + o.id; officer = o; isPending = true; }
        } else if (gameState.activePhase && gameState.activeOfficerId) {
            const o = gameState.officers.find(x => x.id === gameState.activeOfficerId);
            if (o && o.control === 'remote') { key = 'A:' + o.id; officer = o; }
        }
        if (!key) {
            if (netAfkKey) { netAfkKey = null; if (gameState.netCode) netSetStatus(`ルーム作成中（参加コード: ${gameState.netCode}）。世界は自動で進行します。`); }
            return;
        }
        if (key !== netAfkKey) { netAfkKey = key; netAfkDeadline = Date.now() + NET_AFK_LIMIT_MS; }
        const remain = netAfkDeadline - Date.now();
        if (remain <= 0) {
            netAfkKey = null;
            // v7 review fix: exactly one skip log (netSkipRemotePhase logs its own)
            if (isPending) netSkipRemotePhase();
            else { addLog(`${officer.name} のフェイズが制限時間を超えたため、自動でスキップしました（オンライン）。`, 'warn'); finishPlayerPhase(); }
            return;
        }
        netSetStatus(`${officer.name} のフェイズです（自動スキップまで約 ${Math.ceil(remain / 1000)} 秒）`);
    } catch (e) { /* noop */ }
}