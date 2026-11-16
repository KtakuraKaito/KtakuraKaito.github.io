// CHRONICLE OF BETRAYAL — ui.js: 描画・モーダル・通知・セットアップ画面・マップ描画


function addLog(message, type = 'info') {
    message = String(message).replace(/^[\u{1F000}-\u{1FAFF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]+\s*/u, '');
    const logEl = document.getElementById('event-log');
    const entry = document.createElement('div');
    const colors = {
        info: 'text-slate-300',
        good: 'text-emerald-400',
        warn: 'text-amber-400',
        danger: 'text-rose-400 font-bold',
        phase: 'text-sky-400 font-bold'
    };
    entry.className = `${colors[type] || colors.info} leading-snug`;
    entry.textContent = `[${gameState.day}日] ${message}`;
    if (gameState.netMode !== 'guest') {
        gameState.logLines.unshift({ day: gameState.day, text: message, kind: type });
        if (gameState.logLines.length > 80) gameState.logLines.length = 80;
    }
    logEl.prepend(entry);
    if (logEl.children.length > 80) {
        logEl.removeChild(logEl.lastChild);
    }
}

// --- UI刷新: ドット絵顔グラ（16x18）。髪型・髪色・鎧色（勢力色）を武将ごとに固定生成 ---
function makeOfficerFace(officer, size = 40) {
    const cv = document.createElement('canvas');
    cv.width = 16; cv.height = 18;
    cv.className = 'face-px';
    cv.style.width = size + 'px';
    cv.style.height = Math.round(size * 18 / 16) + 'px';
    const ctx2 = cv.getContext('2d');
    if (!ctx2) return cv; // 2D非対応環境（テスト等）では空白のまま返す
    let h = 0;
    const idStr = String(officer.id || officer.name || 'x');
    for (let i = 0; i < idStr.length; i++) h = (h * 31 + idStr.charCodeAt(i)) >>> 0;
    const hairs = ['#3a2c1c', '#14100c', '#7d4a22', '#8a8f7d', '#5d3a1a', '#2e2a26'];
    const skins = ['#e8b98d', '#f2c49b', '#dfa878', '#c9997a'];
    const hair = hairs[h % hairs.length];
    const skin = skins[(h >> 3) % skins.length];
    const style = ['knot', 'long', 'helmet', 'beard'][(h >> 5) % 4];
    const castle = gameState.castles.find(c => c.id === officer.castleId);
    const armor = castle && FACTIONS[castle.factionId] ? FACTIONS[castle.factionId].color : '#57503c';
    const R = (x, y, w, hh, c) => { ctx2.fillStyle = c; ctx2.fillRect(x, y, w, hh); };
    R(0, 0, 16, 18, '#2a2113');
    if (style === 'long') R(3, 2, 10, 13, hair);
    if (style === 'beard') R(4, 11, 8, 3, hair);
    R(4, 4, 8, 8, skin);
    R(7, 12, 2, 2, '#c9997a');
    if (style === 'helmet') { R(3, 2, 10, 3, '#9aa2a8'); R(3, 5, 10, 1, '#6e767d'); R(7, 0, 2, 2, '#d84a3a'); }
    else { R(3, 2, 10, 3, hair); R(3, 2, 2, 7, hair); R(11, 2, 2, 7, hair); if (style === 'knot') R(7, 1, 2, 2, hair); }
    R(5, 6, 2, 1, hair); R(9, 6, 2, 1, hair);
    R(5, 7, 1, 2, '#1c1410'); R(10, 7, 1, 2, '#1c1410');
    R(7, 10, 2, 1, '#a0665a');
    if (style === 'long') R(12, 4, 1, 1, '#c9a44e');
    R(2, 14, 12, 4, armor); R(2, 13, 3, 2, armor); R(11, 13, 3, 2, armor);
    R(7, 13, 2, 4, '#efe6cf');
    return cv;
}

// --- v4 追加: 順位表 ---
function officerScore(o) { return (o.merit || 0) + Math.floor((o.gold || 0) / 2) + Math.floor((o.troops || 0) / 10); }

function openArmiesModal() {
    const viewer = getPlayer();
    const locked = (typeof isHostRemoteLock === 'function') && isHostRemoteLock();
    const rows = gameState.armies.slice().sort((a, b) => a.daysLeft - b.daysLeft).map(army => {
        const origin = gameState.castles.find(c => c.id === army.originCastleId);
        const target = gameState.castles.find(c => c.id === army.targetCastleId);
        const commander = gameState.officers.find(o => o.id === army.commanderId);
        const faction = FACTIONS[army.factionId];
        const troops = army.type === 'ATTACK' ? army.troops : (commander ? commander.troops : 0);
        const kind = army.type === 'ATTACK' ? '⚔ 攻撃' : '🐎 移動';
        const orderText = army.type !== 'ATTACK' ? '' : (army.order === 'WAIT' ? ' / 待機中' : (army.order === 'RETURN' ? ' / 帰還中' : '')) + ((army.forcedUntil && gameState.day <= army.forcedUntil) ? ' / 強行軍中' : '') + ` / 方針:${(STANCES[army.stance] || STANCES.balanced).name}` + (army.supplyReady ? ' / 兵站整備済み' : ''); // v9: 方針表示 / stage E: 兵站表示
        const stats = commander ? `武${commander.valor} 統${commander.leadership} ${TROOP_TYPES[getTroopType(commander)].name}` : '';
        const remainText = army.order === 'WAIT' ? '待機中' : `残${army.daysLeft}日`;
        let orderBtns = '';
        if (army.type === 'ATTACK' && !locked && canOrderArmy(army, viewer)) {
            orderBtns = `<div class="mt-1.5 flex gap-1.5"><button data-order="target" data-army="${army.id}" class="btn-action px-2 py-1 rounded bg-indigo-700 text-white text-[11px] font-bold">目標変更</button>${army.order === 'WAIT' ? `<button data-order="resume" data-army="${army.id}" class="btn-action px-2 py-1 rounded bg-emerald-700 text-white text-[11px] font-bold">進軍再開</button>` : `<button data-order="wait" data-army="${army.id}" class="btn-action px-2 py-1 rounded bg-slate-600 text-white text-[11px] font-bold">待機</button>`}<button data-order="return" data-army="${army.id}" class="btn-action px-2 py-1 rounded bg-amber-700 text-white text-[11px] font-bold">帰還</button></div>`;
        }
        let forcedBtn = '';
        if (army.type === 'ATTACK' && !locked && typeof canForceMarch === 'function' && canForceMarch(army, viewer)) {
            forcedBtn = `<div class="mt-1.5"><button data-forced="${army.id}" class="btn-action px-2 py-1 rounded bg-teal-700 text-white text-[11px] font-bold">強行軍 (指導力${COMMAND_COSTS.forcedMarch} / 移動力+2・3日間)</button></div>`;
        }
        const targetLabel = target ? target.name : (army.targetTile ? `マス(${army.targetTile.q}, ${army.targetTile.r})` : '?'); // v9 stage F: マス目標の表示
        return `<div class="bg-slate-900/70 border border-slate-800 rounded px-3 py-1.5 text-xs"><div class="flex items-center justify-between"><span><span class="font-bold ${army.type === 'ATTACK' ? 'text-rose-300' : 'text-sky-300'}">${kind}</span> <span style="color:${faction ? faction.color : '#e2e8f0'}" class="font-bold">${faction ? faction.name : '不明'}</span> <span class="font-bold text-slate-100">${commander ? commander.name : '不明'} 隊</span> <span class="text-slate-500">${stats}</span> <span class="text-slate-400">${origin ? origin.name : '?'} → ${targetLabel}${orderText}</span></span><span class="font-bold text-amber-300">${troops} 兵 / ${remainText}</span></div>${orderBtns}${forcedBtn}</div>`;
    }).join('');
    const html = rows ? `<div class="space-y-2 max-h-[60vh] overflow-y-auto pr-1">${rows}</div>` : '<p class="text-slate-400 text-sm">現在、出陣中・移動中の部隊はありません。</p>';
    showModal('出陣中・移動中の部隊', html, [{ text: '閉じる', class: 'bg-slate-700 text-slate-200', onClick: closeModal }]);
    document.querySelectorAll('#modal-body [data-order]').forEach(btn => {
        btn.onclick = () => {
            const armyId = btn.getAttribute('data-army');
            const kind = btn.getAttribute('data-order');
            if (kind === 'target') { openArmyTargetModal(armyId); return; }
            if (kind === 'wait') actionArmyOrder(armyId, 'WAIT', null);
            else if (kind === 'resume') { const a = gameState.armies.find(x => x.id === armyId); if (a && !a.targetCastleId && a.targetTile) actionArmyOrder(armyId, 'TILE', null, a.targetTile); else actionArmyOrder(armyId, 'ADVANCE', a ? a.targetCastleId : null); }
            else if (kind === 'return') actionArmyOrder(armyId, 'RETURN', null);
            closeModal();
        };
    });
    document.querySelectorAll('#modal-body [data-forced]').forEach(btn => {
        btn.onclick = () => {
            actionForcedMarch(btn.getAttribute('data-forced'));
            closeModal();
        };
    });
}

// v7: 部隊の目標変更先を選ぶモーダル
// v9 stage F: マス目標（選択中のマス／マップで選ぶ）にも対応
function openArmyTargetModal(armyId) {
    const army = gameState.armies.find(a => a.id === armyId);
    if (!army) return;
    const commander = gameState.officers.find(o => o.id === army.commanderId);
    let html = `<p class="text-xs text-slate-400 mb-2">${commander ? commander.name : '部隊'} 隊の新しい目標を選んでください。自勢力の城へは部隊を移駐できます。出発した城へ戻る場合は「帰還」を使ってください。任意のマスを目標にすると、到着後にそのマスで待機します。</p>`;
    html += `<div class="flex gap-2 mb-2"><button id="army-pick-btn" class="btn-action px-3 py-1.5 rounded bg-slate-600 text-white text-xs font-bold">マップで選ぶ（城・マス）</button>`;
    const sel = gameState.selectedTile;
    if (sel && !gameState.castles.some(c => c.q === sel.q && c.r === sel.r)) {
        const d = (typeof army.posQ === 'number') ? calcDistance(army.posQ, army.posR, sel.q, sel.r) : 0;
        html += `<button id="army-tile-btn" class="btn-action px-3 py-1.5 rounded bg-indigo-700 text-white text-xs font-bold">選択中のマス (${sel.q}, ${sel.r}) へ（現在地から ${d} マス）</button>`;
    }
    html += `</div><div class="space-y-2">`;
    gameState.castles.filter(c => c.id !== army.originCastleId && c.id !== army.targetCastleId).forEach(c => {
        const f = FACTIONS[c.factionId];
        const d = (typeof army.posQ === 'number') ? calcDistance(army.posQ, army.posR, c.q, c.r) : 0;
        html += `<button data-target-castle="${c.id}" class="btn-action w-full text-left bg-slate-900/70 border border-slate-800 rounded px-3 py-2 text-xs"><span class="font-bold text-slate-100">${c.name}</span> <span style="color:${f ? f.color : '#e2e8f0'}">${f ? f.name : ''}</span> <span class="text-slate-400">現在地から ${d} マス / 駐留 ${getCastleTroops(c.id)} 兵</span></button>`;
    });
    html += '</div>';
    showModal('目標の変更', html, [{ text: '戻る', class: 'bg-slate-700 text-slate-200', onClick: () => openArmiesModal() }]);
    document.querySelectorAll('#modal-body [data-target-castle]').forEach(btn => {
        btn.onclick = () => {
            actionArmyOrder(armyId, 'ADVANCE', Number(btn.getAttribute('data-target-castle')));
            closeModal();
        };
    });
    const tileBtn = document.getElementById('army-tile-btn');
    if (tileBtn && sel) tileBtn.onclick = () => { actionArmyOrder(armyId, 'TILE', null, { q: sel.q, r: sel.r }); closeModal(); };
    const pickBtn = document.getElementById('army-pick-btn');
    if (pickBtn) pickBtn.onclick = () => {
        closeModal();
        startMapPick(['castle', 'tile'], (pick) => {
            if (pick.type === 'castle') {
                if (pick.castle.id !== army.originCastleId) actionArmyOrder(armyId, 'ADVANCE', pick.castle.id);
            } else {
                actionArmyOrder(armyId, 'TILE', null, { q: pick.q, r: pick.r });
            }
        }, '部隊の新しい目標を選んでください（城か、マスをクリック）');
    };
}

function openStandingsModal() {
    const rows = [...gameState.officers].sort((a, b) => officerScore(b) - officerScore(a)).slice(0, 15);
    let html = '<div class="space-y-1.5">';
    rows.forEach((o, i) => {
        const castle = gameState.castles.find(c => c.id === o.castleId);
        const h = humanOf(o);
        html += `<div class="flex items-center justify-between bg-slate-900/70 border ${h ? 'border-sky-700' : 'border-slate-800'} rounded px-3 py-1.5 text-xs"><span>${i + 1}位 ${h ? `<span style="color:${h.color}" class="font-bold">${h.label}</span> ` : ''}<span class="font-bold text-slate-100">${o.name}</span> <span class="text-slate-400">${o.trait ? '特性:' + traitName(o.trait) + ' ' : ''}${castle ? castle.name + ' / ' + FACTIONS[castle.factionId].name : '浪人'}</span></span><span class="font-bold text-amber-300">${officerScore(o)} pt</span></div>`;
    });
    html += '</div><p class="text-[11px] text-slate-500 mt-2">スコア = 功績 + 私財/2 + 私兵/10</p>';
    showModal('現在の順位', html, [{ text: '閉じる', class: 'bg-slate-700 text-slate-200', onClick: closeModal }]);
}

// v8: 戦績の要約HTML（天下統一モーダルに埋め込む用）
function chronicleSummaryHtml() {
    const rows = [...gameState.officers].sort((a, b) => officerScore(b) - officerScore(a)).slice(0, 5);
    let html = rows.map((o, i) => {
        const st = o.stats || { castlesTaken: 0, battlesWon: 0 };
        return `<div class="flex items-center justify-between py-0.5"><span>${i + 1}位 <span class="font-bold text-slate-100">${o.name}</span></span><span class="text-slate-300">攻略 ${st.castlesTaken || 0}城 / 戦闘勝利 ${st.battlesWon || 0}回</span><span class="font-bold text-amber-300">${officerScore(o)} pt</span></div>`;
    }).join('');
    const items = (gameState.chronicle || []).slice(-8).reverse();
    if (items.length) {
        html += '<div class="mt-1.5 border-t border-slate-800 pt-1.5">' + items.map(e => `<div class="py-0.5"><span class="text-amber-300 font-bold">${e.day}日目</span> <span class="text-slate-200">${e.text}</span></div>`).join('') + '</div>';
    }
    return html;
}

// v8: 戦績モーダル（最終順位の要約＋クロニクルの年表）
function openChronicleModal() {
    const rows = [...gameState.officers].sort((a, b) => officerScore(b) - officerScore(a)).slice(0, 10);
    let html = `<p class="text-xs text-slate-400 mb-2">${gameState.day}日目時点の戦績です。</p>`;
    html += '<div class="space-y-1.5 mb-4">' + rows.map((o, i) => {
        const st = o.stats || { castlesTaken: 0, battlesWon: 0 };
        const castle = gameState.castles.find(c => c.id === o.castleId);
        return `<div class="flex items-center justify-between bg-slate-900/70 border border-slate-800 rounded px-3 py-1.5 text-xs"><span>${i + 1}位 <span class="font-bold text-slate-100">${o.name}</span> <span class="text-slate-400">${castle ? castle.name : '浪人'}</span></span><span class="text-slate-300">攻略 ${st.castlesTaken || 0}城 / 戦闘勝利 ${st.battlesWon || 0}回</span><span class="font-bold text-amber-300">${officerScore(o)} pt</span></div>`;
    }).join('') + '</div>';
    const items = (gameState.chronicle || []).slice().reverse();
    html += '<div class="text-xs font-bold text-slate-200 mb-1.5">クロニクル（出来事の記録）</div>';
    html += items.length ? '<div class="space-y-1 max-h-[40vh] overflow-y-auto pr-1">' + items.map(e => `<div class="text-xs bg-slate-900/50 border border-slate-800 rounded px-3 py-1.5"><span class="text-amber-300 font-bold">${e.day}日目</span> <span class="text-slate-200">${e.text}</span></div>`).join('') + '</div>' : '<p class="text-xs text-slate-500">まだ大きな出来事は記録されていません。</p>';
    showModal('戦績', html, [{ text: '閉じる', class: 'bg-slate-700 text-slate-200', onClick: closeModal }]);
}

function renderHumansBar() {
    const bar = document.getElementById('humans-bar');
    if (!bar) return;
    const view = getPlayer();
    let html = '<span class="text-slate-500">プレイヤー:</span>';
    gameState.humans.forEach(h => {
        const o = gameState.officers.find(x => x.id === h.officerId);
        if (!o) return;
        const active = view && view.id === o.id;
        html += `<button data-human-view="${o.id}" class="btn-action px-2 py-1 rounded border ${active ? 'border-amber-400 bg-slate-800' : 'border-slate-700 bg-slate-900'} text-slate-200"><span style="color:${h.color}" class="font-bold">${h.label}</span> ${o.name}</button>`;
    });
    html += '<button id="btn-standings" class="btn-action ml-auto px-2.5 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-white font-semibold">順位表</button>';
    html += '<button id="btn-online" class="btn-action px-2.5 py-1 rounded bg-teal-700 hover:bg-teal-600 text-white font-semibold">オンライン</button>';
    html += '<button id="btn-armies" class="btn-action px-2.5 py-1 rounded bg-rose-800 hover:bg-rose-700 text-white font-semibold">部隊一覧</button>';
    if (gameState.netMode === 'host') html += `<span class="text-emerald-300">ホスト中 / コード: ${gameState.netCode}</span>`;
    else if (gameState.netMode === 'guest') html += '<span class="text-emerald-300">オンライン参加中</span>';
    bar.innerHTML = html;
    bar.querySelectorAll('[data-human-view]').forEach(btn => {
        btn.onclick = () => {
            if (gameState.activePhase !== null || gameState.pendingPhase) return;
            gameState.viewOfficerId = btn.getAttribute('data-human-view');
            updateUI();
        };
    });
    const st = document.getElementById('btn-standings');
    if (st) st.onclick = openStandingsModal;
    const onl = document.getElementById('btn-online');
    if (onl) onl.onclick = openNetModal;
    const arm = document.getElementById('btn-armies');
    if (arm) arm.onclick = openArmiesModal;
}




// --- v3 追加: イベント通知（画面表示）とプレイヤー地位の変化検出 ---
const noticeHistory = [];

function showEventNotice(title, body, kind = 'info', opts = {}) {
    if (gameState.netMode === 'host') netBroadcast({ type: 'notice', title, body, kind, opts: { big: !!opts.big, halt: !!opts.halt } });
    const big = !!opts.big;
    if (opts.halt && gameState.autoPlay) body += ' 自動進行を止めました。';
    noticeHistory.push({ day: gameState.day, title, body, kind, big });
    if (noticeHistory.length > 50) noticeHistory.shift();
    if (opts.halt) haltAutoPlay();
    const container = document.getElementById('event-notices');
    if (!container) return;
    const borderColors = { good: 'border-emerald-400', danger: 'border-rose-500', warn: 'border-amber-400', info: 'border-sky-400' };
    const titleColors = { good: 'text-emerald-300', danger: 'text-rose-300', warn: 'text-amber-300', info: 'text-sky-300' };
    const card = document.createElement('div');
    card.className = `notice-card pointer-events-auto cursor-pointer bg-slate-900/95 border-l-4 ${borderColors[kind] || borderColors.info} rounded shadow-2xl ${big ? 'px-5 py-3.5 w-full' : 'px-3.5 py-2'}`;
    card.innerHTML = `<div class="${titleColors[kind] || titleColors.info} font-bold ${big ? 'text-base' : 'text-xs'}">${title}</div><div class="text-slate-200 ${big ? 'text-sm' : 'text-[11px]'} mt-0.5">${body}</div>`;
    let dismissed = false;
    const dismiss = () => { if (dismissed) return; dismissed = true; card.classList.add('notice-out'); setTimeout(() => card.remove(), 380); };
    card.onclick = dismiss;
    container.appendChild(card);
    setTimeout(dismiss, big ? 8000 : 4500);
}

function updateUI() {
    const player = getPlayer();
    const year = Math.floor((gameState.day - 1) / 360) + 1;
    const month = Math.floor(((gameState.day - 1) % 360) / 30) + 1;
    const dayOfMonth = ((gameState.day - 1) % 30) + 1;

    document.getElementById('calendar-display').textContent = `${year}年 ${month}月 ${dayOfMonth}日 (${gameState.day}日目・${getSeason(gameState.day).name})`; // v9: 季節表示

    let rankText = '浪人 (無所属)';
    let rankColor = 'text-slate-400';
    const playerCastle = gameState.castles.find(c => c.id === player.castleId);

    if (player.isMoving) {
        rankText = '行軍・移動中';
        rankColor = 'text-amber-400';
    } else if (playerCastle) {
        const fName = FACTIONS[playerCastle.factionId].name;
        if (isFactionRuler(player)) {
            rankText = `君主 / ${fName} (${playerCastle.name})`;
            rankColor = 'text-amber-400';
        } else if (isCastleLord(player)) {
            rankText = `城主 / ${fName} (${playerCastle.name})`;
            rankColor = 'text-emerald-400';
        } else {
            rankText = `家臣 / ${fName} (${playerCastle.name})`;
            rankColor = 'text-sky-400';
        }

        const policyBanner = document.getElementById('faction-policy-banner');
        const policyTargetId = FACTIONS[playerCastle.factionId].targetCastleId;
        policyBanner.classList.remove('hidden');
        if (policyTargetId) {
            const tCastle = gameState.castles.find(c => c.id === policyTargetId);
            document.getElementById('faction-policy-text').textContent = tCastle ? `${tCastle.name} の攻略` : '未設定';
        } else {
            document.getElementById('faction-policy-text').textContent = '自由行動';
        }
    } else {
        document.getElementById('faction-policy-banner').classList.add('hidden');
    }

    const rankEl = document.getElementById('player-rank-display');
    rankEl.textContent = rankText;
    rankEl.className = `font-bold text-sm ${rankColor}`;

    document.getElementById('player-stats-display').textContent = `${player.valor} / ${player.leadership} / ${player.intellect}`;
     document.getElementById('player-gold-display').textContent = `${player.gold} G`;
const troopsEl = document.getElementById('player-troops-display');
if (troopsEl) troopsEl.textContent = `${player.troops || 0} 兵`;

    const expectedSalary = playerCastle ? calcSalary(player.merit) : 0;
    document.getElementById('player-merit-display').textContent = `${player.merit} pt (${expectedSalary} G/月)`;

    const pLeft = Math.max(0, player.nextPersonalDay - gameState.day);
    const sLeft = player.nextStrategyDay !== null ? `${Math.max(0, player.nextStrategyDay - gameState.day)}日` : '-';
    document.getElementById('player-timer-display').textContent = `個人: ${pLeft}日 / 戦略: ${sLeft}`;

    renderCommandPanel();
    renderSelectedCastle();
    renderHumansBar();
}

function renderCommandPanel() {
const player = getPlayer();
const titleEl = document.getElementById('phase-title');
const badgeEl = document.getElementById('phase-badge');
const descEl = document.getElementById('phase-desc');
const btnsEl = document.getElementById('action-buttons');
btnsEl.innerHTML = '';

if (gameState.activePhase === null) {
titleEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-500"></span>待機中（時間を進めてください）`;
badgeEl.textContent = '待機中';
badgeEl.className = 'text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-400';
descEl.textContent = '「次のフェイズへ」または「+1日」を押して時間を進めてください。';
return;
}

if (gameState.activePhase === 'PERSONAL') {
titleEl.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-sky-400 animate-ping"></span>個人フェイズ実行中`;
badgeEl.textContent = '個人行動';
badgeEl.className = 'text-[11px] px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-700';

if (player.castleId === null) {
descEl.textContent = '浪人状態です。好きな城へ仕官するか、私財を使って他城の不満を煽ることができます。私兵は浪人の間も手元に残ります。';
addActionButton(btnsEl, '🏰 好きな城へ仕官', 'bg-emerald-600 text-white', () => openEnlistModal());
addActionButton(btnsEl, '💰 資金工作 (120G)', 'bg-purple-700 text-white', () => openSabotageModal(), player.gold < 120);
addActionButton(btnsEl, '⏳ 様子を見る (パス)', 'bg-slate-700 text-slate-200', () => finishPlayerPhase());
} else if (player.isMoving) {
// v9 stage E: 行軍中の個人フェイズ（野営）。内政や独立出陣はできないが、部隊を鍛え、兵站を整え、指示を出せる
const army = gameState.armies.find(a => a.commanderId === player.id);
const homeCastle = gameState.castles.find(c => c.id === player.castleId);
if (army) {
const targetCastle = gameState.castles.find(c => c.id === army.targetCastleId);
descEl.textContent = `行軍中（${targetCastle ? targetCastle.name + 'へ、あと約' + army.daysLeft + '日' : '移動中'}）。野営での訓練や兵站整備、部隊への指示ができます。本拠地: ${homeCastle && homeCastle.factionId === army.factionId ? homeCastle.name : 'なし（陥落）'}`;
addActionButton(btnsEl, `🏕️ 野営訓練 (${FIELD_TRAIN_COST_G}G / 部隊の兵UP)`, 'bg-orange-600 text-white', () => actionFieldTrain(), player.gold < FIELD_TRAIN_COST_G);
if (army.type === 'ATTACK') {
addActionButton(btnsEl, army.supplyReady ? '🎒 兵站整備済み (到着時の攻城+10%)' : `🎒 兵站整備 (${SUPPLY_COST_G}G / 到着時の攻城+10%)`, 'bg-amber-600 text-slate-950 font-bold', () => actionSupplyPrep(), !!army.supplyReady || player.gold < SUPPLY_COST_G);
}
addActionButton(btnsEl, '📜 部隊の指示 (目標変更・待機・帰還)', 'bg-sky-700 text-white', () => openArmiesModal());
addActionButton(btnsEl, '⏭️ 個人フェイズ終了', 'bg-slate-700 text-slate-200 col-span-2', () => finishPlayerPhase());
} else {
descEl.textContent = '移動中です。';
addActionButton(btnsEl, '⏭️ 個人フェイズ終了', 'bg-slate-700 text-slate-200 col-span-2', () => finishPlayerPhase());
}
} else {
const castle = gameState.castles.find(c => c.id === player.castleId);
descEl.textContent = `${castle.name}に仕官中。私兵 ${player.troops || 0} 兵。内政と訓練で力を蓄え、独立出陣もできます。`;
addActionButton(btnsEl, `🌾 内政 (${DOMESTIC_COST_G}G / 経済・功績UP)`, 'bg-emerald-600 text-white', () => actionDomesticAffairs(), player.gold < DOMESTIC_COST_G);
addActionButton(btnsEl, `🗡️ 訓練 (${TRAIN_COST_G}G / 私兵UP)`, 'bg-orange-600 text-white', () => actionTrain(), player.gold < TRAIN_COST_G);
if (isCastleLord(player)) {
addActionButton(btnsEl, `🚨 緊急徴兵 (私兵+800 / 城の資金450G / 指導力${COMMAND_COSTS.emergencyLevy})`, 'bg-sky-800 text-white', () => actionEmergencyLevy(), castle.treasury < 450 || getCommand(player) < COMMAND_COSTS.emergencyLevy);
}
addActionButton(btnsEl, '⚔️ 独立出陣 (自分の私兵で出撃)', 'bg-rose-600 text-white', () => openIndependentAttackModal(), Math.floor((player.troops || 0) * 0.9) < 300);
addActionButton(btnsEl, '🐎 自勢力の他城へ移動', 'bg-sky-600 text-white', () => openRelocateModal());
addActionButton(btnsEl, `🎖️ 兵科変更 (現在: ${TROOP_TYPES[getTroopType(player)].name} / ${TROOP_TYPE_CHANGE_COST}G)`, 'bg-teal-700 text-white', () => openTroopTypeModal(), player.gold < TROOP_TYPE_CHANGE_COST);
addActionButton(btnsEl, '💰 資金工作 (120G)', 'bg-purple-700 text-white', () => openSabotageModal(), player.gold < 120);
addActionButton(btnsEl, '🚪 下野する (功績半減)', 'bg-rose-800 text-rose-100', () => openResignModal());
addActionButton(btnsEl, '⏭️ 個人フェイズ終了', 'bg-slate-700 text-slate-200 col-span-2', () => finishPlayerPhase());
}
} else if (gameState.activePhase === 'STRATEGY') {
const castle = gameState.castles.find(c => c.id === player.castleId);
const ruler = isFactionRuler(player);
titleEl.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping"></span>戦略フェイズ（${ruler? '君主': '城主'}特権）`;
badgeEl.textContent = '戦略指揮';
badgeEl.className = 'text-[11px] px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-600';
descEl.textContent = `共有資金: ${castle.treasury}G / 駐留兵力（私兵合計）: ${getCastleTroops(castle.id)}兵 / 指導力: ${getCommand(player)}（上限 ${getCommandCap(player)}。出陣${COMMAND_COSTS.attack}・徴兵${COMMAND_COSTS.recruit}・その他${COMMAND_COSTS.domestic}。毎日 統率ぶん貯まります）/ 個性: ${(SPECIALTIES[castle.specialty] || {}).name || 'なし'}。横領や給与未払いに注意しながら国を運営してください。`; // v9: 上限と個性を表示

addActionButton(btnsEl, `⚔️ 出陣命令 (指導力${COMMAND_COSTS.attack})`, 'bg-rose-600 text-white font-bold', () => openAttackModal(), getCommand(player) < COMMAND_COSTS.attack);
addActionButton(btnsEl, `🛡️ 徴兵 (私兵+400 / 150G / 指導力${COMMAND_COSTS.recruit})`, 'bg-sky-600 text-white', () => actionRecruit(), castle.treasury < 150 || getCommand(player) < COMMAND_COSTS.recruit);
addActionButton(btnsEl, `🚨 緊急徴兵 (私兵+800 / 450G / 指導力${COMMAND_COSTS.emergencyLevy})`, 'bg-sky-800 text-white', () => actionEmergencyLevy(), castle.treasury < 450 || getCommand(player) < COMMAND_COSTS.emergencyLevy);
addActionButton(btnsEl, `🎁 資金分配 (忠誠UP / 150G / 指導力${COMMAND_COSTS.distribute})`, 'bg-emerald-600 text-white', () => actionDistributeFunds(), castle.treasury < 150 || getCommand(player) < COMMAND_COSTS.distribute);
addActionButton(btnsEl, `💼 横領 (+200G / 配下の忠誠-4 / 指導力${COMMAND_COSTS.embezzle})`, 'bg-amber-600 text-slate-950 font-bold', () => actionEmbezzle(), castle.treasury < 200 || getCommand(player) < COMMAND_COSTS.embezzle);
addActionButton(btnsEl, `🌾 内政 (指導力${COMMAND_COSTS.domestic} / ${DOMESTIC_COST_G}G)`, 'bg-emerald-700 text-white', () => actionStrategyDomestic(), getCommand(player) < COMMAND_COSTS.domestic || player.gold < DOMESTIC_COST_G);
addActionButton(btnsEl, `🗡️ 訓練 (指導力${COMMAND_COSTS.train} / ${TRAIN_COST_G}G)`, 'bg-orange-700 text-white', () => actionStrategyTrain(), getCommand(player) < COMMAND_COSTS.train || player.gold < TRAIN_COST_G);
if (ruler) {
addActionButton(btnsEl, `🚩 君主大方針の設定 (指導力${COMMAND_COSTS.policy})`, 'bg-indigo-600 text-white col-span-2', () => openPolicyModal(), getCommand(player) < COMMAND_COSTS.policy);
}
if (player.isMoving) {
descEl.textContent += ' ※行軍中のため、伝令で本拠地を指揮しています。';
}
addActionButton(btnsEl, '⏭️ 戦略フェイズ終了', 'bg-slate-700 text-slate-200 col-span-2', () => finishPlayerPhase());
}

// v7: オンラインで相手（リモート）のフェイズ中は、ホストは閲覧のみ（相手の武将を操作できないようにする）
if (isHostRemoteLock()) {
btnsEl.querySelectorAll('button').forEach(b => { b.disabled = true; });
descEl.textContent += ' ※オンライン参加者のフェイズ中です。ホストは閲覧のみで操作できません。';
}
}

// v8: 成長の表示（例: 成長 武+2 統+1）
function growthText(m) {
    const g = m.growth || {};
    const parts = [];
    if (g.valor) parts.push('武+' + g.valor);
    if (g.leadership) parts.push('統+' + g.leadership);
    if (g.intellect) parts.push('智+' + g.intellect);
    return parts.length ? ' | 成長 ' + parts.join(' ') : '';
}

function addActionButton(container, label, colorClass, onClick, disabled = false) {
    const btn = document.createElement('button');
    const role = /rose/.test(colorClass) ? 'btn-main' : (/sky-800/.test(colorClass) ? 'btn-danger' : '');
    const span = /col-span-2/.test(colorClass) ? 'col-span-2' : '';
    btn.className = `btn-action ${role} ${span} text-xs font-semibold py-2 px-2.5 text-center`;
    btn.textContent = String(label).replace(/^[\u{1F000}-\u{1FAFF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]+\s*/u, '');
    btn.disabled = disabled;
    btn.onclick = onClick;
    container.appendChild(btn);
}

function renderSelectedCastle() {
    const castle = gameState.castles.find(c => c.id === gameState.selectedCastleId) || gameState.castles[0];
    const faction = FACTIONS[castle.factionId];
    const members = getCastleOfficers(castle.id);
    const lord = members[0];
    const player = getPlayer();
    const playerCastle = gameState.castles.find(c => c.id === player.castleId);

    const distEl = document.getElementById('selected-castle-dist');
    if (playerCastle && playerCastle.id !== castle.id) {
        const d = calcDistance(playerCastle.q, playerCastle.r, castle.q, castle.r);
        distEl.textContent = `自城から ${d}マス (行軍 ${calcTravelInfo(playerCastle, castle, player).days}日)`;
    } else {
        distEl.textContent = `座標 (${castle.q}, ${castle.r})`;
    }

    const detailBox = document.getElementById('castle-detail-box');
    const totalSalary = members.reduce((sum, m) => sum + calcSalary(m.merit), 0);
    const monthlyIncome = castle.economy * 2;

    detailBox.innerHTML = `
        <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full inline-block" style="background:${faction.color}"></span>
                <span class="font-bold text-base text-white serif">${castle.name}</span>
            </div>
            <span class="text-xs px-2 py-0.5 rounded font-semibold" style="background:${faction.bg}; color:${faction.color}">
                ${faction.name}
            </span>
        </div>
        <div class="grid grid-cols-3 gap-2 text-xs bg-slate-950/70 p-2 rounded border border-slate-800/80">
            <div>
                <span class="text-slate-400 block text-[10px]">駐留兵力（私兵合計）</span>
 <span class="font-bold text-slate-100">${getCastleTroops(castle.id)} 兵</span>
            </div>
            <div>
                <span class="text-slate-400 block text-[10px]">共有資金</span>
                <span class="font-bold text-amber-400">${castle.treasury} G</span>
            </div>
            <div>
                <span class="text-slate-400 block text-[10px]">経済 / 月収</span>
                <span class="font-bold text-emerald-400">${castle.economy} (+${monthlyIncome}G)</span>
            </div>
        </div>
        <div class="mt-2 flex justify-between text-[11px] text-slate-400">
            <span>城主: <strong class="text-slate-200">${lord ? lord.name : '不在'}</strong>${lord ? ` / 指導力: <strong class="text-violet-300">${getCommand(lord)}（上限 ${getCommandCap(lord)}）</strong>` : ''} / 個性: <strong class="text-teal-300">${(SPECIALTIES[castle.specialty] || {}).name || 'なし'}</strong></span>
            <span>月給与総額: <strong class="${castle.treasury < totalSalary ? 'text-rose-400' : 'text-slate-200'}">${totalSalary} G</strong></span>
            <span>籠城バフ: <strong class="text-sky-300">+${Math.round((getSiegeBuff(castle) - 1) * 100)}%</strong></span> <span>実効守備力: <strong class="text-rose-300">${getEffectiveDefense(castle)}</strong></span> <span>月維持費: <strong class="text-slate-200">${Math.floor(getCastleTroops(castle.id) * 0.02)} G</strong></span> <span>勢力領地: <strong class="text-slate-200">${countTerritory(castle.factionId)}マス</strong></span>${isEncircled(castle) ? ' <span class="text-rose-400 font-bold">包囲中！（籠城バフ低下・荒廃増）</span>' : ''}
        </div>
    `;

    document.getElementById('castle-capacity').textContent = `${members.length}/${MAX_CASTLE_OFFICERS}名`;
    const listEl = document.getElementById('castle-officers-list');
    listEl.innerHTML = '';

    if (members.length === 0) {
        listEl.innerHTML = `<div class="text-xs text-slate-500 text-center py-3">駐留武将はいません</div>`;
        return;
    }

    members.forEach((m, index) => {
        const isLord = index === 0;
        const salary = calcSalary(m.merit);
        const loyaltyColor = m.loyalty < 30 ? 'text-rose-400 font-bold' : (m.loyalty < 60 ? 'text-amber-400' : 'text-emerald-400');

        const card = document.createElement('div');
        card.className = `p-2 rounded border text-xs flex items-center justify-between ${isHuman(m) ? 'bg-sky-950/40 border-sky-700' : 'bg-slate-900/60 border-slate-800'}`;
        card.innerHTML = `
            <div>
                <div class="flex items-center gap-1.5">
                    ${isLord ? '<span class="bg-amber-500 text-slate-950 text-[10px] font-bold px-1.5 rounded">城主</span>' : '<span class="bg-slate-700 text-slate-300 text-[10px] px-1.5 rounded">家臣</span>'}
                    <span class="font-bold text-slate-100">${m.name}</span>
                    ${m.trait ? `<span class="bg-purple-900/70 text-purple-200 text-[10px] px-1.5 rounded">${traitName(m.trait)}</span>` : ''}
                    ${isHuman(m) && humanOf(m) ? `<span class="text-[10px] font-bold" style="color:${humanOf(m).color}">${humanOf(m).label}</span>` : ''}
                </div>
                <div class="text-[11px] text-slate-400 mt-0.5">武:${m.valor} 統:${m.leadership} 智:${m.intellect} | ${TROOP_TYPES[getTroopType(m)].name} | 給料:${salary}G | 私兵:${m.troops || 0}兵${growthText(m)}</div>
            </div>
            <div class="text-right">
                <div class="font-bold text-amber-300">功績 ${m.merit}pt</div>
                <div class="text-[11px] ${loyaltyColor}">忠誠: ${isLord ? '城主' : m.loyalty}</div>
            </div>
        `;
        card.prepend(makeOfficerFace(m, 34));
        card.style.gap = '8px';
        listEl.appendChild(card);
    });
}

// v8: 選択中マスの情報パネル（城情報と同じ枠に描く）
function renderSelectedTile() {
    const t = gameState.selectedTile;
    if (!t) return;
    const cell = gameState.mapGrid[t.r] && gameState.mapGrid[t.r][t.q];
    const terrain = cell ? cell.terrain : TERRAIN.PLAIN;
    const owner = getTerritory(t.q, t.r);
    const faction = owner ? FACTIONS[owner] : null;
    const dev = getDevelopment(t.q, t.r);
    const viewer = getPlayer();
    const distEl = document.getElementById('selected-castle-dist');
    if (distEl) distEl.textContent = `座標 (${t.q}, ${t.r})`;
    const detailBox = document.getElementById('castle-detail-box');
    if (!detailBox) return;
    let html = `<div class="mb-2"><span class="font-bold text-slate-100">${terrain.name}のマス</span> <span class="text-slate-400 text-xs">(${t.q}, ${t.r})</span></div>`;
    html += `<div class="text-xs text-slate-300 space-y-1">`;
    html += `<div>領地: ${faction ? `<span style="color:${faction.color}" class="font-bold">${faction.name}</span>` : '<span class="text-slate-500">中立</span>'}</div>`;
    const viewerCastle = viewer ? gameState.castles.find(c => c.id === viewer.castleId) : null;
    html += `<div>移動コスト: ${tileEnterCost(t.q, t.r, viewerCastle ? viewerCastle.factionId : 0)}（あなたの勢力の部隊が入る場合）</div>`;
    html += `<div>開発: ${dev === 1 ? '🌾 農地（領地収入 +1G/月）' : (dev === 2 ? '🏯 関所（敵部隊の進入コスト +2）' : 'なし')}</div>`;
    const fort = (typeof fortAt === 'function') ? fortAt(t.q, t.r) : null; // v9 stage F: 支砦の表示
    if (fort) {
        const ff = FACTIONS[fort.factionId];
        const home = gameState.castles.find(c => c.id === fort.homeCastleId);
        html += `<div>支砦: <span style="color:${ff ? ff.color : '#e2e8f0'}" class="font-bold">${ff ? ff.name : '不明'}</span>（本拠: ${home ? home.name : '?'}）守備 ${fort.garrison} 兵 ＝ 実効 ${Math.round(fort.garrison * FORT_DEFENSE_MULT * (getTerritory(t.q, t.r) === fort.factionId ? TERRITORY_BUFF : 1))} 相当</div>`;
    }
    html += `</div>`;
    if (dev === 0 && viewer && canDevelopTile(viewer, t.q, t.r)) {
        html += `<div class="mt-3 flex gap-2"><button id="btn-develop-farm" class="btn-action px-3 py-1.5 rounded bg-amber-700 text-white text-xs font-bold">🌾 農地を開発 (200G / 指導力${COMMAND_COSTS.develop})</button><button id="btn-develop-gate" class="btn-action px-3 py-1.5 rounded bg-slate-600 text-white text-xs font-bold">🏯 関所を設置 (300G / 指導力${COMMAND_COSTS.develop})</button></div>`;
        html += `<div class="text-[11px] text-slate-500 mt-1">費用は自分の城の共有資金から。領地が他勢力に移ると施設は失われます。</div>`;
    }
    if (!fort && viewer && typeof canBuildFort === 'function' && canBuildFort(viewer, t.q, t.r)) {
        const vCastle = gameState.castles.find(c => c.id === viewer.castleId);
        const cost = vCastle ? fortBuildCost(vCastle) : 0;
        html += `<div class="mt-3"><button id="btn-build-fort" class="btn-action px-3 py-1.5 rounded bg-amber-700 text-white text-xs font-bold">支砦を建設 (${cost}G / 指導力${COMMAND_COSTS.fort})</button></div>`;
        html += `<div class="text-[11px] text-slate-500 mt-1">城の駐留兵から守備 ${FORT_GARRISON} 兵を割きます。支砦は半径 ${FORT_RADIUS} マスを自勢力の領地に固め、本拠の城の守備に援護 +${Math.round(FORT_SUPPORT_RATE * 100)}% を与えます。</div>`;
    }
    detailBox.innerHTML = html;
    const bf = document.getElementById('btn-develop-farm');
    if (bf) bf.onclick = () => actionDevelopTile(t.q, t.r, 1);
    const bg = document.getElementById('btn-develop-gate');
    if (bg) bg.onclick = () => actionDevelopTile(t.q, t.r, 2);
    const bb = document.getElementById('btn-build-fort');
    if (bb) bb.onclick = () => actionBuildFort(t.q, t.r);
}

function showModal(title, bodyHtml, buttons) {
    pauseAutoTimer();
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    const footer = document.getElementById('modal-footer');
    footer.innerHTML = '';

    buttons.forEach(b => {
        const btn = document.createElement('button');
        btn.className = `btn-action px-4 py-2 rounded-lg text-xs ${b.class}`;
        btn.textContent = b.text;
        btn.onclick = b.onClick;
        footer.appendChild(btn);
    });

    document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    startAutoTimer();
}

function openEnlistModal() {
    let html = `<p class="text-xs text-slate-400 mb-2">仕官する城を選択してください。</p><div class="space-y-2">`;
    gameState.castles.forEach(c => {
        const count = getCastleOfficers(c.id).length;
        const lord = getCastleLord(c.id);
        const fName = FACTIONS[c.factionId].name;
        const full = count >= MAX_CASTLE_OFFICERS;
        html += `
            <div class="flex items-center justify-between p-2.5 rounded bg-slate-900 border border-slate-700">
                <div>
                    <div class="font-bold text-white">${c.name} <span class="text-xs font-normal text-slate-400">(${fName})</span></div>
                    <div class="text-xs text-slate-400">城主: ${lord ? lord.name : '不在'} / 人数:${count}/${MAX_CASTLE_OFFICERS}</div>
                </div>
                <button onclick="actionEnlist(${c.id})" ${full ? 'disabled' : ''} class="btn-action bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded">
                    ${full ? '満員' : '仕官する'}
                </button>
            </div>
        `;
    });
    html += `</div>`;
    showModal('仕官先の選択', html, [{ text: 'キャンセル', class: 'bg-slate-700 text-slate-200', onClick: closeModal }]);
}

// v8: 兵科変更モーダル
function openTroopTypeModal() {
    const player = getPlayer();
    if (!player) return;
    const cur = getTroopType(player);
    const html = `<p class="text-xs text-slate-400 mb-2">現在の兵科: <span class="font-bold text-slate-100">${TROOP_TYPES[cur].name}</span>。変更には ${TROOP_TYPE_CHANGE_COST}G かかります。</p><div class="space-y-2">` +
        Object.entries(TROOP_TYPES).map(([id, t]) => `<button data-troop="${id}" ${id === cur ? 'disabled' : ''} class="btn-action w-full text-left bg-slate-900/70 border border-slate-800 rounded px-3 py-2 text-xs ${id === cur ? 'opacity-50' : ''}"><span class="font-bold text-slate-100">${t.name}</span> <span class="text-slate-400">${t.desc}</span>${id === cur ? ' <span class="text-teal-300">（現在）</span>' : ''}</button>`).join('') + '</div>';
    showModal('兵科変更', html, [{ text: 'やめる', class: 'bg-slate-700 text-slate-200', onClick: closeModal }]);
    document.querySelectorAll('#modal-body [data-troop]').forEach(btn => {
        btn.onclick = () => { actionChangeTroopType(btn.getAttribute('data-troop')); closeModal(); };
    });
}

function openRelocateModal() {
    const player = getPlayer();
    const origin = gameState.castles.find(c => c.id === player.castleId);
    const allies = gameState.castles.filter(c => c.factionId === origin.factionId && c.id !== origin.id);

    if (allies.length === 0) {
        showModal('移動不可', '<p>自勢力の他の城がありません。</p>', [{ text: '閉じる', class: 'bg-slate-700 text-white', onClick: closeModal }]);
        return;
    }

    let html = `<p class="text-xs text-slate-400 mb-2">移動先の城を選択してください。</p><div class="mb-2"><button id="relocate-pick-btn" class="btn-action px-3 py-1.5 rounded bg-slate-600 text-white text-xs font-bold">マップで選ぶ（自勢力の城）</button></div><div class="space-y-2">`;
    allies.forEach(c => {
        const dist = calcDistance(origin.q, origin.r, c.q, c.r);
 const travelDaysRel = calcTravelInfo(origin, c, player).days;
 html += `
            <div class="flex items-center justify-between p-2.5 rounded bg-slate-900 border border-slate-700">
                <div>
                    <div class="font-bold text-white">${c.name}</div>
                    <div class="text-xs text-slate-400">距離: ${dist}マス（${travelDaysRel}日）</div>
                </div>
                <button onclick="actionRelocate(${c.id})" class="btn-action bg-sky-600 text-white text-xs font-bold px-3 py-1.5 rounded">
                    移動開始
                </button>
            </div>
        `;
    });
    html += `</div>`;
    showModal('転属・移動先の選択', html, [{ text: 'キャンセル', class: 'bg-slate-700 text-slate-200', onClick: closeModal }]);
    const relPickBtn = document.getElementById('relocate-pick-btn');
    if (relPickBtn) relPickBtn.onclick = () => {
        closeModal();
        startMapPick(['castle'], (pick) => {
            if (pick.castle.factionId === origin.factionId && pick.castle.id !== origin.id) actionRelocate(pick.castle.id);
            else { showEventNotice('移動できません', '自勢力の他の城を選んでください。', 'warn', {}); openRelocateModal(); }
        }, '移動先の城を選んでください（自勢力の城をクリック）');
    };
}

function openSabotageModal() {
    let html = `<p class="text-xs text-slate-400 mb-2">私財 <strong>120G</strong> を使って他城の配下の不満を煽ります。</p><div class="mb-2"><button id="sabotage-pick-btn" class="btn-action px-3 py-1.5 rounded bg-slate-600 text-white text-xs font-bold">マップで選ぶ（城）</button></div><div class="space-y-2">`;
    gameState.castles.forEach(c => {
        const members = getCastleOfficers(c.id);
        const fName = FACTIONS[c.factionId].name;
        html += `
            <div class="flex items-center justify-between p-2.5 rounded bg-slate-900 border border-slate-700">
                <div>
                    <div class="font-bold text-white">${c.name} <span class="text-xs text-slate-400">(${fName})</span></div>
                    <div class="text-xs text-slate-400">駐留武将: ${members.length}名</div>
                </div>
                <button onclick="actionBribeSabotage(${c.id})" class="btn-action bg-purple-600 text-white text-xs font-bold px-3 py-1.5 rounded">
                    工作実行
                </button>
            </div>
        `;
    });
    html += `</div>`;
    showModal('資金工作（不満の扇動）', html, [{ text: 'キャンセル', class: 'bg-slate-700 text-slate-200', onClick: closeModal }]);
    const sabPickBtn = document.getElementById('sabotage-pick-btn');
    if (sabPickBtn) sabPickBtn.onclick = () => {
        closeModal();
        startMapPick(['castle'], (pick) => { actionBribeSabotage(pick.castle.id); }, '工作の対象の城を選んでください（城をクリック）');
    };
}

function openResignModal() {
    const player = getPlayer();
    showModal(
        '下野の確認',
        `<p>本当に下野して浪人に戻りますか？</p><p class="text-rose-400 font-bold">ペナルティ：功績（${player.merit}pt）が半減します。</p>`,
        [
            { text: 'キャンセル', class: 'bg-slate-700 text-slate-200', onClick: closeModal },
            { text: '下野する', class: 'bg-rose-600 text-white font-bold', onClick: actionResign }
        ]
    );
}

let attackModalMode = 'strategy';
var atkDesiredTotal = null;
let atkTargetTile = null; // v9 stage F: 出陣モーダルで選んだマス目標（城目標のときは null）
let indTargetTile = null; // v9 stage F: 独立出陣モーダルのマス目標
window.onAttackSliderInput = function() { const s = document.getElementById('atk-troops-slider'); if (s) { atkDesiredTotal = parseInt(s.value); updateAttackPreview(); } };

function openAttackModal(preset) {
attackModalMode = 'strategy';
atkTargetTile = (preset && preset.tile) ? { q: preset.tile.q, r: preset.tile.r } : null;
const player = getPlayer();
const myCastle = gameState.castles.find(c => c.id === player.castleId);
const ruler = isFactionRuler(player);

const originCastles = ruler
? gameState.castles.filter(c => c.factionId === myCastle.factionId)
: [myCastle];

const enemyCastles = gameState.castles.filter(c => c.factionId!== myCastle.factionId);
if (enemyCastles.length === 0 && !atkTargetTile) return;

let html = `<div class="space-y-3">
<div>
<label class="block text-xs text-slate-400 mb-1">出撃元の城</label>
<select id="atk-origin-select" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-white" onchange="atkDesiredTotal=null; updateAttackPreview()">
${originCastles.map(c => `<option value="${c.id}">${c.name} (駐留兵力: ${getCastleTroops(c.id)})</option>`).join('')}
</select>
</div>
<div>
<label class="block text-xs text-slate-400 mb-1">攻撃目標（敵城、または任意のマス）</label>
<select id="atk-target-select" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-white" onchange="atkDesiredTotal=null; updateAttackPreview()">
${enemyCastles.map(c => `<option value="${c.id}">${c.name} [${FACTIONS[c.factionId].name}] (守備: ${getCastleTroops(c.id)})</option>`).join('')}
${atkTargetTile ? `<option value="tile">マス (${atkTargetTile.q}, ${atkTargetTile.r})${fortAt(atkTargetTile.q, atkTargetTile.r) ? ' の支砦' : ''}</option>` : ''}
</select>
<button id="atk-pick-btn" class="btn-action mt-1.5 px-3 py-1.5 rounded bg-slate-600 text-white text-xs font-bold">マップで選ぶ（城・マス）</button>
</div>
<div>
<label class="block text-xs text-slate-400 mb-1">出陣指揮官（供出上限: 指揮官は私兵の全て、他の駐留武将は半分）</label>
<select id="atk-cmd-select" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-white" onchange="updateAttackPreview()"></select>
</div>
<div>
<label class="block text-xs text-slate-400 mb-1">出陣兵力（スライダーで調整）</label>
<input type="range" id="atk-troops-slider" class="w-full" min="300" max="300" step="10" value="300" oninput="onAttackSliderInput()">
<div class="flex justify-between text-[10px] text-slate-500"><span>最小 300</span><span id="atk-slider-max-label"></span></div>
</div>
<div>
<label class="block text-xs text-slate-400 mb-1">部隊方針</label>
<select id="atk-stance-select" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-white">
<option value="balanced">バランス（補正なし）</option>
<option value="assault">突撃（与える損害+15%／受ける損害+15%）</option>
<option value="guard">堅守（与える損害-10%／受ける損害-15%）</option>
</select>
</div>
<div id="atk-preview-box" class="bg-slate-900/90 p-2.5 rounded border border-slate-700 text-xs text-slate-300"></div>
</div>`;

showModal('出陣命令の編成', html, [
{ text: 'キャンセル', class: 'bg-slate-700 text-slate-200', onClick: closeModal},
{
text: '出陣を実行する',
class: 'bg-rose-600 text-white font-bold',
onClick: () => {
const oId = parseInt(document.getElementById('atk-origin-select').value);
const tSel = document.getElementById('atk-target-select').value;
const cId = document.getElementById('atk-cmd-select').value;
const sliderEl = document.getElementById('atk-troops-slider');
const stanceEl = document.getElementById('atk-stance-select');
if (tSel === 'tile' && atkTargetTile) {
actionLaunchAttack(oId, null, cId, 'strategy', sliderEl ? parseInt(sliderEl.value) : null, stanceEl ? stanceEl.value : null, atkTargetTile.q, atkTargetTile.r);
} else {
actionLaunchAttack(oId, parseInt(tSel), cId, 'strategy', sliderEl ? parseInt(sliderEl.value) : null, stanceEl ? stanceEl.value : null);
}
}
}
]);

// v9 stage F: プリセット（マップで選んだ目標）の反映と、マップ選択ボタン
const atkTargetSelEl = document.getElementById('atk-target-select');
if (atkTargetSelEl) {
if (atkTargetTile) atkTargetSelEl.value = 'tile';
else if (preset && preset.castleId) atkTargetSelEl.value = String(preset.castleId);
}
const atkPickBtn = document.getElementById('atk-pick-btn');
if (atkPickBtn) atkPickBtn.onclick = () => {
closeModal();
startMapPick(['castle', 'tile'], (pick) => {
if (pick.type === 'castle') openAttackModal({ castleId: pick.castle.id });
else openAttackModal({ tile: { q: pick.q, r: pick.r } });
}, '出陣の目標を選んでください（敵の城か、マスをクリック）');
};

updateAttackPreview();
}

// v2: 独立出陣モーダル（個人フェイズ用。自分の私兵の90パーセントで出撃）
function openIndependentAttackModal(preset) {
attackModalMode = 'independent';
indTargetTile = (preset && preset.tile) ? { q: preset.tile.q, r: preset.tile.r } : null;
const player = getPlayer();
const myCastle = gameState.castles.find(c => c.id === player.castleId);
if (!myCastle) return;
const enemyCastles = gameState.castles.filter(c => c.factionId!== myCastle.factionId);
if (enemyCastles.length === 0 && !indTargetTile) return;

let html = `<div class="space-y-3">
<p class="text-xs text-slate-400">城主の命令を待たず、自分の私兵から兵力を選んで出撃します（最低300兵）。勝てば攻略した城にそのまま移ります。</p>
<div>
<label class="block text-xs text-slate-400 mb-1">出撃兵力（自分の私兵 ${player.troops || 0} 兵から）</label>
<input type="range" id="ind-troops-slider" class="w-full" min="${Math.min(300, player.troops || 0)}" max="${player.troops || 0}" step="10" value="${Math.floor((player.troops || 0) * 0.9)}" oninput="updateIndependentPreview()">
</div>
<div>
<label class="block text-xs text-slate-400 mb-1">攻撃目標（敵城、または任意のマス）</label>
<select id="ind-target-select" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-white" onchange="updateIndependentPreview()">
${enemyCastles.map(c => `<option value="${c.id}">${c.name} [${FACTIONS[c.factionId].name}] (守備: ${getCastleTroops(c.id)})</option>`).join('')}
${indTargetTile ? `<option value="tile">マス (${indTargetTile.q}, ${indTargetTile.r})${fortAt(indTargetTile.q, indTargetTile.r) ? ' の支砦' : ''}</option>` : ''}
</select>
<button id="ind-pick-btn" class="btn-action mt-1.5 px-3 py-1.5 rounded bg-slate-600 text-white text-xs font-bold">マップで選ぶ（城・マス）</button>
</div>
<div>
<label class="block text-xs text-slate-400 mb-1">部隊方針</label>
<select id="ind-stance-select" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-white">
<option value="balanced">バランス（補正なし）</option>
<option value="assault">突撃（与える損害+15%／受ける損害+15%）</option>
<option value="guard">堅守（与える損害-10%／受ける損害-15%）</option>
</select>
</div>
<div id="ind-preview-box" class="bg-slate-900/90 p-2.5 rounded border border-slate-700 text-xs text-slate-300"></div>
</div>`;

showModal('独立出陣', html, [
{ text: 'キャンセル', class: 'bg-slate-700 text-slate-200', onClick: closeModal},
{
text: '出陣を実行する',
class: 'bg-rose-600 text-white font-bold',
onClick: () => {
const tSel = document.getElementById('ind-target-select').value;
const indSlider = document.getElementById('ind-troops-slider');
const indStanceEl = document.getElementById('ind-stance-select');
if (tSel === 'tile' && indTargetTile) {
actionLaunchAttack(myCastle.id, null, player.id, 'independent', indSlider ? parseInt(indSlider.value) : null, indStanceEl ? indStanceEl.value : null, indTargetTile.q, indTargetTile.r);
} else {
actionLaunchAttack(myCastle.id, parseInt(tSel), player.id, 'independent', indSlider ? parseInt(indSlider.value) : null, indStanceEl ? indStanceEl.value : null);
}
}
}
]);

// v9 stage F: プリセット反映とマップ選択ボタン（出陣モーダルと同じ）
const indTargetSelEl = document.getElementById('ind-target-select');
if (indTargetSelEl) {
if (indTargetTile) indTargetSelEl.value = 'tile';
else if (preset && preset.castleId) indTargetSelEl.value = String(preset.castleId);
}
const indPickBtn = document.getElementById('ind-pick-btn');
if (indPickBtn) indPickBtn.onclick = () => {
closeModal();
startMapPick(['castle', 'tile'], (pick) => {
if (pick.type === 'castle') openIndependentAttackModal({ castleId: pick.castle.id });
else openIndependentAttackModal({ tile: { q: pick.q, r: pick.r } });
}, '出陣の目標を選んでください（敵の城か、マスをクリック）');
};

updateIndependentPreview();
}

window.updateIndependentPreview = function() {
const player = getPlayer();
const origin = gameState.castles.find(c => c.id === player.castleId);
const tSelVal = document.getElementById('ind-target-select').value;
const isTileTarget = tSelVal === 'tile' && indTargetTile; // v9 stage F: マス目標
const target = isTileTarget ? null : gameState.castles.find(c => c.id === parseInt(tSelVal));
if (!origin || (!target && !isTileTarget)) return;
const travel = calcTravelInfo(origin, target ? target : indTargetTile, player);
const indSlider = document.getElementById('ind-troops-slider');
const sendTroops = indSlider ? parseInt(indSlider.value) : Math.floor((player.troops || 0) * 0.9);
let targetLine;
if (target) {
const fortNote = fortSupportRate(target) > 1 ? `、支砦援護 +${Math.round((fortSupportRate(target) - 1) * 100)}%` : '';
targetLine = `<div>目標の実効守備力: <strong class="text-rose-300">${getEffectiveDefense(target)} 兵相当</strong>（駐留 ${getCastleTroops(target.id)} 兵、籠城バフ +${Math.round((getSiegeBuff(target) - 1) * 100)}%${fortNote}）</div>`;
} else {
const tileFort = fortAt(indTargetTile.q, indTargetTile.r);
targetLine = tileFort
? `<div>目標の支砦: <strong class="text-rose-300">守備 ${tileFort.garrison} 兵 ＝ 実効 ${Math.round(tileFort.garrison * FORT_DEFENSE_MULT * (getTerritory(indTargetTile.q, indTargetTile.r) === tileFort.factionId ? TERRITORY_BUFF : 1))} 相当</strong></div>`
: `<div>目標のマス: <strong class="text-slate-200">(${indTargetTile.q}, ${indTargetTile.r})</strong>（到着後はそのマスで待機します）</div>`;
}
document.getElementById('ind-preview-box').innerHTML = `
<div>出撃兵力: <strong class="text-amber-400">${sendTroops} 兵</strong>（出撃後に残る私兵: ${(player.troops || 0) - sendTroops} 兵）</div>
${targetLine}
<div>行軍日数: <strong class="text-sky-400">${travel.days} 日</strong></div>
<div class="text-slate-400">内訳: 距離 ${travel.dist}マス / マス目移動（経路の地形コスト ÷ 1日の移動力。敵地は+1）</div>
`;
};

window.updateAttackPreview = function() {
const oId = parseInt(document.getElementById('atk-origin-select').value);
const tSelVal = document.getElementById('atk-target-select').value;
const isTileTarget = tSelVal === 'tile' && atkTargetTile; // v9 stage F: マス目標
const tId = isTileTarget ? null : parseInt(tSelVal);
const origin = gameState.castles.find(c => c.id === oId);
const target = isTileTarget ? null : gameState.castles.find(c => c.id === tId);
if (!origin || (!target && !isTileTarget)) return;

const cmdSelect = document.getElementById('atk-cmd-select');
const prevCmd = cmdSelect.value;
const members = getCastleOfficers(oId);
cmdSelect.innerHTML = members.map(m => `<option value="${m.id}">${m.name} (武勇:${m.valor} / 私兵:${m.troops || 0})</option>`).join('');
if (prevCmd && members.some(m => m.id === prevCmd)) cmdSelect.value = prevCmd;
const commander = members.find(m => m.id === cmdSelect.value) || members[0];
if (!commander) {
document.getElementById('atk-preview-box').innerHTML = '<div>出撃できる武将がいません。</div>';
return;
}

const travel = calcTravelInfo(origin, target ? target : atkTargetTile, commander);
const plan = planExpedition(origin, commander);
const slider = document.getElementById('atk-troops-slider');
const desired = (atkDesiredTotal == null) ? plan.total : Math.max(Math.min(300, plan.total), Math.min(plan.total, atkDesiredTotal));
if (slider) {
slider.min = Math.min(300, plan.total);
slider.max = plan.total;
slider.value = desired;
const maxLbl = document.getElementById('atk-slider-max-label');
if (maxLbl) maxLbl.textContent = '最大 ' + plan.total + ' 兵';
}
const adj = buildAdjustedPlan(origin, commander, desired);
const remain = getCastleTroops(origin.id) - adj.total;
const warn = remain < 500 ? `<div class="text-rose-400 font-bold">警告: 出陣後、城に残る守備は ${remain} 兵だけです</div>` : '';

let targetLine;
if (target) {
const fortNote = fortSupportRate(target) > 1 ? `、支砦援護 +${Math.round((fortSupportRate(target) - 1) * 100)}%` : '';
targetLine = `<div>目標の実効守備力: <strong class="text-rose-300">${getEffectiveDefense(target)} 兵相当</strong>（駐留 ${getCastleTroops(target.id)} 兵、籠城バフ +${Math.round((getSiegeBuff(target) - 1) * 100)}%${fortNote}）</div>`;
} else {
// v9 stage F: マス目標のプレビュー
const tileFort = fortAt(atkTargetTile.q, atkTargetTile.r);
const tileOwner = getTerritory(atkTargetTile.q, atkTargetTile.r);
const tileOwnerName = tileOwner ? (FACTIONS[tileOwner] ? FACTIONS[tileOwner].name : '不明') : '中立';
targetLine = tileFort
? `<div>目標の支砦: <strong class="text-rose-300">守備 ${tileFort.garrison} 兵 ＝ 実効 ${Math.round(tileFort.garrison * FORT_DEFENSE_MULT * (tileOwner === tileFort.factionId ? TERRITORY_BUFF : 1))} 相当</strong>（${tileOwnerName}の領地）</div><div class="text-slate-400">支砦を落とすと周辺の領地が自勢力の色に変わります。</div>`
: `<div>目標のマス: <strong class="text-slate-200">(${atkTargetTile.q}, ${atkTargetTile.r})</strong>（領地: ${tileOwnerName}）</div><div class="text-slate-400">到着した部隊はそのマスで待機し、前線の足場になります。</div>`;
}
document.getElementById('atk-preview-box').innerHTML = `
<div>出撃兵力: <strong class="text-amber-400">${adj.total} 兵</strong>（出陣後、城に残る守備: ${remain} 兵）</div>
${targetLine}
<div>行軍日数: <strong class="text-sky-400">${travel.days} 日</strong></div>
<div class="text-slate-400">内訳: 距離 ${travel.dist}マス / マス目移動（経路の地形コスト ÷ 1日の移動力。敵地は+1）</div>
${warn}
`;
};

function openPolicyModal() {
    const player = getPlayer();
    const myCastle = gameState.castles.find(c => c.id === player.castleId);
    const enemies = gameState.castles.filter(c => c.factionId !== myCastle.factionId);

    let html = `<p class="text-xs text-slate-400 mb-2">勢力全体の攻撃目標を指定します。</p><div class="mb-2"><button id="policy-pick-btn" class="btn-action px-3 py-1.5 rounded bg-slate-600 text-white text-xs font-bold">マップで選ぶ（敵の城）</button></div><div class="space-y-2">`;
    enemies.forEach(c => {
        html += `
            <div class="flex items-center justify-between p-2.5 rounded bg-slate-900 border border-slate-700">
                <div>
                    <div class="font-bold text-white">${c.name} <span class="text-xs text-slate-400">[${FACTIONS[c.factionId].name}]</span></div>
                </div>
                <button onclick="actionSetFactionPolicy(${c.id})" class="btn-action bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded">
                    目標に設定
                </button>
            </div>
        `;
    });
    html += `</div>`;
    showModal('君主大方針の設定', html, [{ text: 'キャンセル', class: 'bg-slate-700 text-slate-200', onClick: closeModal }]);
    const polPickBtn = document.getElementById('policy-pick-btn');
    if (polPickBtn) polPickBtn.onclick = () => {
        closeModal();
        startMapPick(['castle'], (pick) => {
            if (pick.castle.factionId !== myCastle.factionId) actionSetFactionPolicy(pick.castle.id);
            else { showEventNotice('設定できません', '敵の城を選んでください。', 'warn', {}); openPolicyModal(); }
        }, '大方針の目標を選んでください（敵の城をクリック）');
    };
}

function updateAutoButton() {
    const btn = document.getElementById('btn-auto-toggle');
    if (!btn) return;
    if (gameState.autoHalted) {
        btn.textContent = '自動進行: 停止中（押して再開）';
        btn.className = 'btn-action bg-amber-600 hover:bg-amber-500 text-xs font-bold px-2.5 py-1.5 rounded text-slate-950';
    } else if (gameState.autoPlay) {
        btn.textContent = '自動進行: ON';
        btn.className = 'btn-action bg-rose-600 hover:bg-rose-500 text-xs font-bold px-2.5 py-1.5 rounded text-white animate-pulse';
    } else {
        btn.textContent = '自動進行: OFF';
        btn.className = 'btn-action bg-emerald-700 hover:bg-emerald-600 text-xs font-semibold px-2.5 py-1.5 rounded text-white';
    }
}

function startAutoTimer() {
    if (!gameState.autoPlay || gameState.autoHalted) return;
    if (gameState.autoTimer) return;
    if (gameState.activePhase !== null) return;
    if (gameState.pendingPhase || !gameState.setupDone) return;
    const hov = document.getElementById('handover-overlay');
    if (hov && !hov.classList.contains('hidden')) return;
    const sov = document.getElementById('setup-overlay');
    if (sov && !sov.classList.contains('hidden')) return;
    const overlay = document.getElementById('modal-overlay');
    if (overlay && !overlay.classList.contains('hidden')) return;
    gameState.autoTimer = setInterval(() => { advanceOneDay(); }, 280);
}

function pauseAutoTimer() {
    if (gameState.autoTimer) {
        clearInterval(gameState.autoTimer);
        gameState.autoTimer = null;
    }
}

// 大きな出来事で自動を止める（設定はONのまま、ボタンで再開）
function haltAutoPlay() {
    pauseAutoTimer();
    if (gameState.autoPlay) gameState.autoHalted = true;
    updateAutoButton();
}

function stopAutoPlay() {
    gameState.autoPlay = false;
    gameState.autoHalted = false;
    pauseAutoTimer();
    updateAutoButton();
}
let setupCount = 1;

function showSetup() {
    const ms = document.getElementById('setup-mapsize');
    if (ms) ms.value = gameState.mapSize || 'standard';
    renderSetupCountButtons();
    renderSetupSlots();
    document.getElementById('setup-overlay').classList.remove('hidden');
}

function renderSetupCountButtons() {
    const wrap = document.getElementById('setup-count-btns');
    wrap.innerHTML = '';
    [1, 2, 3, 4].forEach(n => {
        const b = document.createElement('button');
        b.className = `btn-action px-3 py-1.5 rounded text-xs font-bold ${n === setupCount ? 'bg-amber-600 text-slate-950' : 'bg-slate-800 text-slate-300'}`;
        b.textContent = n + '人';
        b.onclick = () => { setupCount = n; renderSetupCountButtons(); renderSetupSlots(); };
        wrap.appendChild(b);
    });
}

function renderSetupSlots() {
    const wrap = document.getElementById('setup-slots');
    wrap.innerHTML = '';
    for (let i = 0; i < setupCount; i++) {
        const row = document.createElement('div');
        row.className = 'bg-slate-950/60 border border-slate-800 rounded-lg p-3';
        const castleOpts = '<option value="0">浪人から始める</option>' + gameState.castles.map(c => `<option value="${c.id}">${c.name}（${FACTIONS[c.factionId].name}）</option>`).join('');
        const traitOpts = '<option value="">特性はランダム</option>' + Object.entries(TRAITS).map(([id, t]) => `<option value="${id}">${t.name} - ${t.desc}</option>`).join('');
        const troopOpts = Object.entries(TROOP_TYPES).map(([id, t]) => `<option value="${id}">${t.name} - ${t.desc}</option>`).join('');
        const controlHtml = gameState.netMode === 'host' ? `<select id="setup-control-${i}" class="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100"><option value="local">この画面で操作</option><option value="remote">オンライン参加者</option></select>` : '';
        row.innerHTML = `<div class="flex items-center gap-2 mb-2"><span class="w-3 h-3 rounded-full" style="background:${HUMAN_COLORS[i]}"></span><span class="text-xs font-bold text-slate-200">${HUMAN_LABELS[i]}</span></div><div class="grid grid-cols-3 gap-2"><input id="setup-name-${i}" type="text" maxlength="10" value="プレイヤー${i + 1}" class="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100"><select id="setup-castle-${i}" class="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100">${castleOpts}</select><select id="setup-trait-${i}" class="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100">${traitOpts}</select><select id="setup-troop-${i}" class="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100">${troopOpts}</select>${controlHtml}</div>`;
        wrap.appendChild(row);
        const ctl = document.getElementById(`setup-control-${i}`);
        if (ctl && i > 0) ctl.value = 'remote';
    }
}

function confirmSetup() {
    const errEl = document.getElementById('setup-error');
    const configs = [];
    const perCastle = {};
    for (let i = 0; i < setupCount; i++) {
        const name = ((document.getElementById(`setup-name-${i}`).value || '').replace(/[<>&"']/g, '').trim() || `プレイヤー${i + 1}`).slice(0, 10);
        const castleId = parseInt(document.getElementById(`setup-castle-${i}`).value, 10) || 0;
        const trait = document.getElementById(`setup-trait-${i}`).value || null;
        const troopEl = document.getElementById(`setup-troop-${i}`);
        const troopType = troopEl ? troopEl.value : 'archer';
        if (castleId > 0) {
            perCastle[castleId] = (perCastle[castleId] || 0) + 1;
            const capacity = MAX_CASTLE_OFFICERS - getCastleOfficers(castleId).filter(o => !isHuman(o)).length;
            if (perCastle[castleId] > capacity) {
                errEl.textContent = '同じ城を選んだプレイヤーが多すぎます（1城あたり最大3人まで）。';
                errEl.classList.remove('hidden');
                return;
            }
        }
        const controlEl = document.getElementById(`setup-control-${i}`);
        const control = gameState.netMode === 'host' ? (controlEl ? controlEl.value : (i === 0 ? 'local' : 'remote')) : 'local';
        configs.push({ name, castleId, trait, control, troopType });
    }
    errEl.classList.add('hidden');
    gameState.officers = gameState.officers.filter(o => !isHuman(o));
    gameState.humans = [];
    const traitIds = Object.keys(TRAITS);
    configs.forEach((cfg, i) => {
        const id = 'h' + (i + 1);
        gameState.humans.push({ id, officerId: id, label: HUMAN_LABELS[i], color: HUMAN_COLORS[i] });
        gameState.officers.push({
            id, name: cfg.name, humanId: id, isPlayer: true,
            trait: cfg.trait || traitIds[Math.floor(Math.random() * traitIds.length)],
            control: cfg.control,
            valor: 76, leadership: 74, intellect: 84,
            troopType: cfg.troopType || 'archer',
            castleId: cfg.castleId > 0 ? cfg.castleId : null,
            gold: 250, troops: 500, merit: 0, loyalty: 100,
            nextPersonalDay: 4 + i * 2, nextStrategyDay: null, isMoving: false
        });
    });
    gameState.viewOfficerId = 'h1';
    gameState.activeOfficerId = null;
    gameState.setupDone = true;
    document.getElementById('setup-overlay').classList.add('hidden');
    syncCastleLords();
    checkPlayerStatusEvents();
    saveGame();
    updateUI();
    drawMap();
    addLog(`ゲーム開始！ ${configs.map(c => c.name).join('、')} が名乗りを上げました。`, 'phase');
    netProcessPending();
    netSync();
    if (gameState.netMode === 'host') netEnableOnlineAuto(); // v7: ホスト中は世界を自動進行
}

// --- Canvas マップ描画 ---
const canvas = document.getElementById('map-canvas');
const ctx = canvas.getContext('2d');
let hexMetrics = { radius: 32, offsetX: 50, offsetY: 50 };

function resizeCanvas() {
    const parent = canvas.parentElement;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    drawMap();
}
window.addEventListener('resize', resizeCanvas);

function hexToPixel(q, r) {
    const R = hexMetrics.radius;
    const width = Math.sqrt(3) * R;
    const height = 2 * R;
    const x = hexMetrics.offsetX + q * width + (r % 2 === 1 ? width / 2 : 0);
    const y = hexMetrics.offsetY + r * (height * 0.75);
    return { x, y };
}

function drawHex(cx, cy, r, fillStyle, strokeStyle, lineWidth = 1) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * (60 * i - 30);
        const px = cx + r * Math.cos(angle);
        const py = cy + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
}

function drawMap() {
    if (!ctx || gameState.mapGrid.length === 0) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const maxR_W = (canvas.width - 60) / ((MAP_COLS + 0.5) * Math.sqrt(3));
    const maxR_H = (canvas.height - 80) / (MAP_ROWS * 1.5 + 0.5);
    const R = Math.max(20, Math.min(44, Math.min(maxR_W, maxR_H)));
    hexMetrics.radius = R;

    const totalW = (MAP_COLS + 0.5) * Math.sqrt(3) * R;
    const totalH = (MAP_ROWS * 1.5 + 0.5) * R;
    hexMetrics.offsetX = (canvas.width - totalW) / 2 + R;
    hexMetrics.offsetY = (canvas.height - totalH) / 2 + R + 12;

    for (let r = 0; r < MAP_ROWS; r++) {
        for (let q = 0; q < MAP_COLS; q++) {
            const cell = gameState.mapGrid[r][q];
            const { x, y } = hexToPixel(q, r);
            drawHex(x, y, R - 1, cell.terrain.color, cell.terrain.stroke, 1);
        }
    }

    // v7: 領地を勢力色で薄く塗る
    if (gameState.territory && gameState.territory.length) {
        for (let r = 0; r < MAP_ROWS; r++) {
            for (let q = 0; q < MAP_COLS; q++) {
                const owner = gameState.territory[r][q];
                if (owner && FACTIONS[owner]) {
                    const p = hexToPixel(q, r);
                    drawHex(p.x, p.y, R - 1, FACTIONS[owner].bg, FACTIONS[owner].bg, 1);
                }
            }
        }
    }

    // v8: 開発施設のマーカーと選択中マスの枠
    if (gameState.development && gameState.development.length) {
        ctx.font = `bold ${Math.max(10, Math.floor(R * 0.5))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let r = 0; r < MAP_ROWS; r++) {
            for (let q = 0; q < MAP_COLS; q++) {
                const dev = gameState.development[r][q];
                if (!dev) continue;
                const p = hexToPixel(q, r);
                ctx.fillStyle = dev === 1 ? '#d9b95f' : '#efe6cf';
                ctx.fillText(dev === 1 ? '農' : '関', p.x, p.y - R * 0.42);
            }
        }
    }
    if (gameState.selectedTile) {
        const p = hexToPixel(gameState.selectedTile.q, gameState.selectedTile.r);
        drawHex(p.x, p.y, R - 1, 'rgba(201,164,78,0.13)', '#c9a44e', 2);
    }

    gameState.castles.forEach(castle => {
        const { x, y } = hexToPixel(castle.q, castle.r);
        const faction = FACTIONS[castle.factionId];
        const isSelected = castle.id === gameState.selectedCastleId;

        if (isSelected) {
            drawHex(x, y, R + 2, 'transparent', '#ffe9ad', 3);
        }

        drawHex(x, y, R * 0.72, faction.color, '#0d0a06', 2);

        // 城郭シルエット（ドット絵風）を濃色で抜く
        const s = R / 32;
        ctx.fillStyle = 'rgba(13,10,6,0.88)';
        ctx.beginPath();
        ctx.moveTo(x - 11 * s, y + 8 * s);
        ctx.lineTo(x - 11 * s, y - 6 * s); ctx.lineTo(x - 7 * s, y - 6 * s); ctx.lineTo(x - 7 * s, y - 11 * s);
        ctx.lineTo(x - 3 * s, y - 11 * s); ctx.lineTo(x - 3 * s, y - 6 * s); ctx.lineTo(x + 3 * s, y - 6 * s);
        ctx.lineTo(x + 3 * s, y - 11 * s); ctx.lineTo(x + 7 * s, y - 11 * s); ctx.lineTo(x + 7 * s, y - 6 * s);
        ctx.lineTo(x + 11 * s, y - 6 * s); ctx.lineTo(x + 11 * s, y + 8 * s);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = faction.color;
        ctx.fillRect(x - 2 * s, y + 1 * s, 4 * s, 7 * s);

        // 名前と兵数はカードなしの縁取り文字（モック3方針）
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 11px "Noto Serif JP", sans-serif';
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(10,8,4,0.92)'; ctx.lineJoin = 'round';
        ctx.strokeText(castle.name, x, y + R * 0.95);
        ctx.fillStyle = isSelected ? '#ffe9ad' : '#efe6cf';
        ctx.fillText(castle.name, x, y + R * 0.95);

        ctx.font = '10px "DotGothic16", monospace';
        ctx.lineWidth = 3;
        const troopsText = `兵 ${getCastleTroops(castle.id)}`;
        ctx.strokeText(troopsText, x, y + R * 1.28);
        ctx.fillStyle = '#cfc4a4';
        ctx.fillText(troopsText, x, y + R * 1.28);
    });

    // v9 stage F: 支砦（城より小さい六角＋櫓シルエット＋守備数）
    (gameState.forts || []).forEach(fort => {
        const { x, y } = hexToPixel(fort.q, fort.r);
        const faction = FACTIONS[fort.factionId];
        const color = faction ? faction.color : '#8a8f7d';
        drawHex(x, y, R * 0.46, color, '#0d0a06', 1.5);
        const s = R / 32;
        ctx.fillStyle = 'rgba(13,10,6,0.9)';
        ctx.beginPath();
        ctx.moveTo(x - 6 * s, y + 6 * s);
        ctx.lineTo(x - 6 * s, y - 3 * s); ctx.lineTo(x - 3.5 * s, y - 3 * s); ctx.lineTo(x - 3.5 * s, y - 7 * s);
        ctx.lineTo(x + 3.5 * s, y - 7 * s); ctx.lineTo(x + 3.5 * s, y - 3 * s); ctx.lineTo(x + 6 * s, y - 3 * s);
        ctx.lineTo(x + 6 * s, y + 6 * s);
        ctx.closePath(); ctx.fill();
        ctx.font = 'bold 9px "DotGothic16", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,8,4,0.92)'; ctx.lineJoin = 'round';
        const fortText = `砦 ${fort.garrison}`;
        ctx.strokeText(fortText, x, y + R * 0.66);
        ctx.fillStyle = '#efe6cf';
        ctx.fillText(fortText, x, y + R * 0.66);
    });

    gameState.armies.forEach(army => {
        const target = gameState.castles.find(c => c.id === army.targetCastleId);
        const destPoint = target ? { q: target.q, r: target.r } : (army.targetTile || null); // v9 stage F: マス目標の部隊も描く
        if (!destPoint || typeof army.posQ !== 'number') return;

        const cur = hexToPixel(army.posQ, army.posR);
        const tp = hexToPixel(destPoint.q, destPoint.r);

        // v7: 残りの経路を点線で描く
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.moveTo(cur.x, cur.y);
        (army.path || []).forEach(t => { const p = hexToPixel(t.q, t.r); ctx.lineTo(p.x, p.y); });
        ctx.lineTo(tp.x, tp.y);
        ctx.strokeStyle = FACTIONS[army.factionId] ? FACTIONS[army.factionId].color : '#8a8f7d';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);

        // 旗マーカー（勢力色の軍旗 + 攻/移）
        const aFaction = FACTIONS[army.factionId];
        const aColor = aFaction ? aFaction.color : '#8a8f7d';
        ctx.strokeStyle = '#0d0a06';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cur.x - 5, cur.y - 10); ctx.lineTo(cur.x - 5, cur.y + 10); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cur.x - 5, cur.y - 10); ctx.lineTo(cur.x + 9, cur.y - 6); ctx.lineTo(cur.x - 5, cur.y - 2);
        ctx.closePath();
        ctx.fillStyle = aColor;
        ctx.fill();
        ctx.strokeStyle = 'rgba(13,10,6,0.9)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#efe6cf';
        ctx.font = 'bold 10px "DotGothic16", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(army.type === 'ATTACK' ? '攻' : '移', cur.x + 1, cur.y + 5);

        // v7: 指揮官名・兵力・状態（残日数／待機／帰還）を表示する
        const labelCommander = gameState.officers.find(o => o.id === army.commanderId);
        const labelTroops = army.type === 'ATTACK' ? army.troops : (labelCommander ? labelCommander.troops : 0);
        const stateText = army.order === 'WAIT' ? '待機中' : (army.order === 'RETURN' ? `帰還中 残${army.daysLeft}日` : `残${army.daysLeft}日`);
        ctx.font = 'bold 9px "DotGothic16", sans-serif';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,8,4,0.92)'; ctx.lineJoin = 'round';
        const labelName = labelCommander ? labelCommander.name : '不明';
        ctx.strokeText(labelName, cur.x, cur.y - 43);
        ctx.fillStyle = '#d9b95f';
        ctx.fillText(labelName, cur.x, cur.y - 43);
        ctx.strokeText(`${labelTroops}兵`, cur.x, cur.y - 31);
        ctx.fillStyle = '#efe6cf';
        ctx.fillText(`${labelTroops}兵`, cur.x, cur.y - 31);
        ctx.strokeText(stateText, cur.x, cur.y - 19);
        ctx.fillStyle = '#cfc4a4';
        ctx.fillText(stateText, cur.x, cur.y - 19);
    });
}

// v9 stage F: マップ選択モード。目標が要る操作を、リストだけでなくマップのクリックでも選べるようにする共通の仕組み。
// モード中はバナーが出て、クリックが通常の選択ではなく「目標の確定」として処理される。
let mapPick = null; // { kinds: ['castle'|'tile', ...], onPick: function }
function startMapPick(kinds, onPick, message) {
    mapPick = { kinds, onPick };
    const banner = document.getElementById('pick-banner');
    const text = document.getElementById('pick-banner-text');
    if (text) text.textContent = message || 'マップで目標を選んでください（城やマスをクリック）';
    if (banner) banner.classList.remove('hidden');
}
function cancelMapPick() {
    mapPick = null;
    const banner = document.getElementById('pick-banner');
    if (banner) banner.classList.add('hidden');
}
function resolveMapPick(pick) {
    if (!mapPick || !mapPick.kinds.includes(pick.type)) return false;
    const cb = mapPick.onPick;
    cancelMapPick();
    cb(pick);
    return true;
}

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    let clickedCastle = null;
    let minDist = Infinity;

    gameState.castles.forEach(c => {
        const { x, y } = hexToPixel(c.q, c.r);
        const d = Math.hypot(clickX - x, clickY - y);
        if (d <= hexMetrics.radius * 1.1 && d < minDist) {
            minDist = d;
            clickedCastle = c;
        }
    });

    // v8: 城でないマスを選ぶと、そのマスの情報と領地開発ボタンを出す
    let bestTile = null;
    let bestDist = Infinity;
    for (let r = 0; r < MAP_ROWS; r++) {
        for (let q = 0; q < MAP_COLS; q++) {
            const p = hexToPixel(q, r);
            const d = Math.hypot(clickX - p.x, clickY - p.y);
            if (d < bestDist) { bestDist = d; bestTile = { q, r }; }
        }
    }

    // v9 stage F: マップ選択モード中は、クリックを目標の確定として処理する（対象外の種類をクリックしてもモードは続く）
    if (mapPick) {
        if (clickedCastle && resolveMapPick({ type: 'castle', castle: clickedCastle })) return;
        if (!clickedCastle && bestTile && bestDist <= hexMetrics.radius * 1.1 && resolveMapPick({ type: 'tile', q: bestTile.q, r: bestTile.r })) return;
        return;
    }

    if (clickedCastle) {
        gameState.selectedCastleId = clickedCastle.id;
        gameState.selectedTile = null;
        renderSelectedCastle();
        drawMap();
        return;
    }

    if (bestTile && bestDist <= hexMetrics.radius * 1.1) {
        gameState.selectedTile = bestTile;
        renderSelectedTile();
        drawMap();
    }
});