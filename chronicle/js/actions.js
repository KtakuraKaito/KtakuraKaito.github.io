// CHRONICLE OF BETRAYAL — actions.js: 行動・フェイズ進行・NPC・日次処理
 // v7: 領地1マスあたりの月収入（勢力の君主の城の金庫へ）

// v7: 指導力（城主でいる間、毎日 統率ぶん貯まる。戦略フェイズの全行動で消費する）
function getCommand(o) { return Math.floor((o && o.command) || 0); }
// v9: 指導力の上限は統率×25
function getCommandCap(o) { return Math.floor(((o && o.leadership) || 0) * COMMAND_CAP_PER_LEADERSHIP); }
function spendCommand(o, cost) {
    if (!o || getCommand(o) < cost) return false;
    o.command = getCommand(o) - cost;
    return true;
}
// v7: フェイズを終わらせない行動の後の画面・保存・同期リフレッシュ
function refreshPhasePanel() { updateUI(); drawMap(); saveGame(); netSync(); }

function runWorldEvent() {
    if (Math.random() >= 0.35) return;
    const castle = gameState.castles[Math.floor(Math.random() * gameState.castles.length)];
    if (!castle) return;
    const lord = getCastleLord(castle.id);
    const idx = Math.floor(Math.random() * WORLD_EVENT_TEXTS.length);
    const text = WORLD_EVENT_TEXTS[idx];
    const body = text.body.replaceAll('{castle}', castle.name).replaceAll('{lord}', lord ? lord.name : '城主');
    let kind = 'info';
    if (idx === 0) { castle.treasury += 300; }
    else if (idx === 1) { kind = 'warn'; getCastleOfficers(castle.id).forEach(o => { o.troops = Math.max(80, Math.floor((o.troops || 0) * 0.9)); }); }
    else if (idx === 2) { castle.treasury += 400; }
    else if (idx === 3) { if (lord && castle.treasury >= 300) { castle.treasury -= 300; lord.troops = (lord.troops || 0) + 600; } }
    else if (idx === 4) { kind = 'warn'; getCastleOfficers(castle.id).slice(1).forEach(o => { o.loyalty = Math.max(0, o.loyalty - loyaltyLossFor(o, 10)); }); }
    else if (idx === 5) { castle.economy = Math.min(ECONOMY_MAX, castle.economy + 15); castle.treasury += 150; }
    addLog(`【イベント】${text.title}: ${body}`, kind === 'warn' ? 'warn' : 'info');
    const humanHere = getCastleOfficers(castle.id).some(o => isHuman(o));
    showEventNotice(text.title, body, kind, { big: humanHere });
}

function maybeVisitor() {
    if (Math.random() >= 0.2) return;
    if (gameState.officers.length >= 30) return;
    const used = new Set(gameState.officers.map(o => o.name));
    const candidates = VISITOR_NAMES.filter(n => !used.has(n));
    if (!candidates.length) return;
    const name = candidates[Math.floor(Math.random() * candidates.length)];
    const traitIds = Object.keys(TRAITS);
    const newcomer = {
        id: 'vis' + Date.now() + Math.floor(Math.random() * 1000), name, humanId: null, isPlayer: false,
        trait: traitIds[Math.floor(Math.random() * traitIds.length)],
        valor: 60 + Math.floor(Math.random() * 31), leadership: 60 + Math.floor(Math.random() * 31), intellect: 55 + Math.floor(Math.random() * 36),
        castleId: null, gold: 150, troops: 800 + Math.floor(Math.random() * 800),
        merit: 50 + Math.floor(Math.random() * 100), loyalty: 80,
        nextPersonalDay: gameState.day + 3, nextStrategyDay: null, isMoving: false
    };
    newcomer.troopType = defaultTroopType(newcomer); // v8
    gameState.officers.push(newcomer);
    addLog(`流浪の武将 ${name}（特性: ${traitName(newcomer.trait)}）がこの地に現れました。`, 'info');
    showEventNotice('流浪の武将あらわる', `${name}（特性: ${traitName(newcomer.trait)}）が仕官先を求めて現れました。`, 'info', {});
}

function maybePersonalEvent(officer) {
    if (!officer || Math.random() >= 0.25) return;
    const idx = Math.floor(Math.random() * PERSONAL_EVENT_TEXTS.length);
    const text = PERSONAL_EVENT_TEXTS[idx];
    const body = text.body.replaceAll('{officer}', officer.name);
    let kind = 'info';
    if (idx === 0) { officer.gold += officer.trait === 'wealth' ? 180 : 120; kind = 'good'; }
    else if (idx === 1) { officer.merit += meritGainFor(officer, 25); kind = 'good'; }
    else if (idx === 2) { officer.troops = (officer.troops || 0) + Math.round(180 * (officer.trait === 'drill' ? 1.3 : 1.0)); kind = 'good'; }
    else if (idx === 3) { if (officer.gold >= 100) { officer.gold -= 100; officer.troops = (officer.troops || 0) + 250; kind = 'good'; } }
    else if (idx === 4) { officer.merit += meritGainFor(officer, 15); kind = 'good'; }
    else if (idx === 5) { officer.troops = Math.max(80, Math.floor((officer.troops || 0) * 0.95)); kind = 'warn'; }
    addLog(`【イベント】${text.title}: ${body}`, kind === 'warn' ? 'warn' : 'good');
    showEventNotice(text.title, body, kind, {});
}

// v7: 部隊に指示を出せるのは、指揮官本人か、NPC指揮官を出した城の城主
function canOrderArmy(army, officer) {
    if (!army || army.type !== 'ATTACK' || !officer) return false;
    const commander = gameState.officers.find(o => o.id === army.commanderId);
    if (!commander) return false;
    if (commander.id === officer.id) return true;
    if (!isHuman(commander) && (isCastleLord(officer) || isMarchingLord(officer)) && officer.castleId === army.originCastleId) { // v9 stage E review fix: 行軍中の城主も配下の部隊に指示できる
    const originCastle = gameState.castles.find(c => c.id === army.originCastleId);
    if (originCastle && originCastle.factionId === army.factionId) return true; // v7 review fix: an enemy lord who captured the origin castle gets no orders over its armies
    }
    return false;
}

// v7: 部隊指示の適用（目標変更・待機・帰還）。成功したら true
// v9 stage F: kind 'TILE' で任意のマスを目標にできる（targetTile = {q, r}）
function setArmyOrder(army, kind, targetCastleId, targetTile) {
    const commander = gameState.officers.find(o => o.id === army.commanderId);
    const cmdName = commander ? commander.name : '部隊';
    if (kind === 'WAIT') {
        if (army.order === 'WAIT') return false; // v7 review fix: repeated identical orders are no-ops (log/sync spam)
        army.order = 'WAIT';
        addLog(`${cmdName} 隊は現在地で待機に入りました。`, 'info');
        return true;
    }
    if (kind === 'RETURN') {
        const origin = gameState.castles.find(c => c.id === army.originCastleId);
        if (!origin || typeof army.posQ !== 'number') return false;
        if (army.order === 'RETURN') return false; // v7 review fix: same as WAIT
        army.order = 'RETURN';
        army.targetCastleId = origin.id;
        army.targetTile = null;
        army.path = findPath(army.posQ, army.posR, origin.q, origin.r, army.factionId);
        army.daysLeft = Math.max(1, estimateDaysForPath(army.path, commander, army.factionId, army.forcedUntil || 0));
        addLog(`${cmdName} 隊に ${origin.name} への帰還命令が出ました。`, 'info');
        return true;
    }
    if (kind === 'ADVANCE') {
        const target = gameState.castles.find(c => c.id === targetCastleId);
        if (!target || typeof army.posQ !== 'number') return false;
        if (target.id === army.targetCastleId && army.order !== 'WAIT') return false;
        army.order = 'ADVANCE';
        army.targetCastleId = target.id;
        army.targetTile = null;
        army.path = findPath(army.posQ, army.posR, target.q, target.r, army.factionId);
        army.daysLeft = Math.max(1, estimateDaysForPath(army.path, commander, army.factionId, army.forcedUntil || 0));
        addLog(`${cmdName} 隊の目標が ${target.name} に変更されました。`, 'info');
        return true;
    }
    if (kind === 'TILE') {
        if (!targetTile || !Number.isInteger(targetTile.q) || !Number.isInteger(targetTile.r)) return false;
        if (targetTile.q < 0 || targetTile.q >= MAP_COLS || targetTile.r < 0 || targetTile.r >= MAP_ROWS) return false;
        if (typeof army.posQ !== 'number') return false;
        if (gameState.castles.some(c => c.q === targetTile.q && c.r === targetTile.r)) return false; // 城マスは城目標で指定する
        if (!army.targetCastleId && army.targetTile && army.targetTile.q === targetTile.q && army.targetTile.r === targetTile.r && army.order !== 'WAIT') return false;
        army.order = 'ADVANCE';
        army.targetCastleId = null;
        army.targetTile = { q: targetTile.q, r: targetTile.r };
        army.path = findPath(army.posQ, army.posR, targetTile.q, targetTile.r, army.factionId);
        army.daysLeft = Math.max(1, estimateDaysForPath(army.path, commander, army.factionId, army.forcedUntil || 0));
        addLog(`${cmdName} 隊の目標がマス (${targetTile.q}, ${targetTile.r}) に変更されました。`, 'info');
        return true;
    }
    return false;
}

// v7: 部隊指示の入口（ゲストはホストへ送信、ホスト・ローカルは即適用）
function actionArmyOrder(armyId, kind, targetCastleId, targetTile) {
    if (gameState.netMode === 'guest') {
        if (netHostConn && netHostConn.open !== false) {
            try { netHostConn.send({ type: 'order', armyId, kind, targetCastleId: (typeof targetCastleId === 'number') ? targetCastleId : null, targetQ: (targetTile && Number.isInteger(targetTile.q)) ? targetTile.q : null, targetR: (targetTile && Number.isInteger(targetTile.r)) ? targetTile.r : null }); } catch (e) { /* noop */ }
        }
        return;
    }
    if (typeof isHostRemoteLock === 'function' && isHostRemoteLock()) return;
    const army = gameState.armies.find(a => a.id === armyId);
    const viewer = getPlayer();
    if (!army || !canOrderArmy(army, viewer)) return;
    if (setArmyOrder(army, kind, targetCastleId, targetTile)) { saveGame(); netSync(); }
}

function playerRankOf(player) {
    if (!player) return 'ronin';
    if (player.isMoving) return 'moving';
    if (player.castleId === null) return 'ronin';
    if (isFactionRuler(player)) return 'ruler';
    if (isCastleLord(player)) return 'lord';
    return 'member';
}

// v4: 地位の変化検出は全プレイヤー分を個別に見る
function checkStatusEventsFor(officer) {
    if (!officer) return;
    const rank = playerRankOf(officer);
    if (rank === 'moving') return; // 移動中は基準を更新しない
    const cur = { rank, castleId: officer.castleId };
    const last = gameState._statusByOfficer[officer.id];
    gameState._statusByOfficer[officer.id] = cur;
    if (!last) return;
    if (last.rank === 'moving') return;
    const castle = gameState.castles.find(c => c.id === cur.castleId);
    if (!castle) return;
    const rankValue = { ronin: 0, member: 1, lord: 2, ruler: 3 };
    if ((rank === 'lord' || rank === 'ruler') && rankValue[rank] > (rankValue[last.rank] ?? 0)) {
        if (rank === 'ruler') {
            showEventNotice('君主に就任', `${officer.name}が${FACTIONS[castle.factionId].name}の君主になりました。`, 'good', { big: true });
        } else {
            showEventNotice('城主に就任', `${officer.name}が${castle.name}の城主になりました。戦略フェイズが使えるようになります。`, 'good', { big: true });
        }
    } else if ((last.rank === 'lord' || last.rank === 'ruler') && rank === 'member' && last.castleId === cur.castleId) {
        showEventNotice('城主の座を失った', `${officer.name}が${castle.name}で他武将に功績を抜かれ、城主ではなくなりました。`, 'danger', { big: true, halt: true });
    } else if (last.rank === 'ruler' && rank === 'lord' && last.castleId === cur.castleId) {
        showEventNotice('君主の座を失った', `${officer.name}は${castle.name}の城主ではありますが、勢力の君主ではなくなりました。`, 'danger', { big: true, halt: true });
    }
}

function checkPlayerStatusEvents() {
    gameState.officers.filter(o => isHuman(o)).forEach(checkStatusEventsFor);
}

// 訓練の増加量（仕様4.2: 少ないうちは爆発的、大軍ほど緩やかになる逓減カーブ）
function calcTrainGain(officer) {
const base = 420 * (2000 / (2000 + (officer.troops || 0)));
const traitMul = officer.trait === 'drill' ? 1.3 : 1.0;
return Math.max(30, Math.floor(base * (0.8 + officer.leadership / 200) * traitMul));
}

// 内政の経済増加量（経済上限に近づくほど逓減し、上限では0）
function calcEcoGain(baseGain, castle) {
if (!castle || castle.economy >= ECONOMY_MAX) return 0;
const factor = Math.max(0.05, 1 - castle.economy / (ECONOMY_MAX * 1.2));
return Math.max(1, Math.floor(baseGain * factor));
}

// --- 時間進行エンジン ---
function advanceOneDay() {
    if (gameState.netMode === 'guest') return;
    if (gameState.activePhase !== null || gameState.pendingPhase || gameState.pendingRebellion || !gameState.setupDone) {
        pauseAutoTimer();
        return;
    }

    // v7 review fix: a day interrupted by a human phase resumes where it stopped (no double day advance / world processing)
    const resumingDay = typeof gameState.dayResumeIdx === 'number';
    if (!resumingDay) {
    gameState.day++;

    // v7/v9: 指導力の蓄積（城主でいる間、毎日その城主の統率ぶん貯まる。上限は統率×25）
    gameState.officers.forEach(o => {
        if (isCastleLord(o) || isMarchingLord(o)) o.command = Math.min(getCommandCap(o), getCommand(o) + (o.leadership || 0)); // v9 stage E review fix: 行軍中の城主にも指導力が貯まる
    });

    if (gameState.day % 10 === 0) {
        gameState.officers.forEach(o => {
            if (o.castleId === null && !o.isMoving) {
                const roninIncome = o.trait === 'wealth' ? 45 : 30;
                o.gold += roninIncome;
                if (isHuman(o)) {
                    addLog(`${o.name}の浪人としての雑業収入 +${roninIncome}G を得ました。`, 'info');
                }
            }
        });
    }

    if (gameState.day % PAYDAY_INTERVAL === 0) {
        processMonthlyEconomy();
    }

    processArmiesMovement();
    processFieldBattles();
    syncCastleLords();
    processDailyRebellions();
    if (gameState.pendingRebellion) { updateUI(); drawMap(); saveGame(); return; } // v8 review fix: 決起判断が出るまでその日の残り処理を止める
    checkPlayerStatusEvents();
    }

    const startOfficerIdx = resumingDay ? gameState.dayResumeIdx : 0;
    for (let oi = startOfficerIdx; oi < gameState.officers.length; oi++) {
        const officer = gameState.officers[oi];
        // v9 stage E: 行軍中の武将にも手番を回す（個人は野営フェイズ、城主は伝令で戦略フェイズ）

        const interval = calcActionInterval(officer);

        if (gameState.day >= officer.nextPersonalDay) {
            officer.nextPersonalDay = gameState.day + interval;
            if (isCastleLord(officer) || isMarchingLord(officer)) {
                officer.nextStrategyDay = gameState.day + Math.floor(interval / 2);
            }

            if (isHuman(officer)) {
                pauseAutoTimer();
                gameState.pendingPhase = { officerId: officer.id, type: 'PERSONAL' };
                gameState.dayResumeIdx = oi + 1;
                saveGame();
                if (officer.control === 'remote') { netSync(); updateUI(); } else { showHandover(); }
                return;
            } else {
                if (officer.isMoving) executeNpcMarchPersonal(officer); else executeNpcPersonalPhase(officer);
            }
        }

        if (officer.nextStrategyDay !== null && gameState.day >= officer.nextStrategyDay) {
            officer.nextStrategyDay = null;
            // v9 stage E: 本来の城主が行軍中なら、その城の戦略フェイズは行軍中の城主が伝令で取る（留守の代理は譲る）
            const topAny = officer.castleId ? castleTopOfficer(officer.castleId) : null;
            const marchingTopAway = !!(topAny && topAny.isMoving && topAny.id !== officer.id);
            if (!marchingTopAway && (isCastleLord(officer) || isMarchingLord(officer))) {
                if (isHuman(officer)) {
                    pauseAutoTimer();
                    gameState.pendingPhase = { officerId: officer.id, type: 'STRATEGY' };
                    gameState.dayResumeIdx = oi + 1;
                    saveGame();
                    if (officer.control === 'remote') { netSync(); updateUI(); } else { showHandover(); }
                    return;
                } else {
                    executeNpcStrategyPhase(officer);
                }
            }
        }
    }

    gameState.dayResumeIdx = null;
     checkUnification();
updateUI();
drawMap();
saveGame();
}

function processMonthlyEconomy() {
addLog(`=== ${Math.floor(gameState.day / 30)}ヶ月目の収支・給与決済 ===`, 'warn');

// v9 review fix: 領地収入は給与支払いより先に君主の城へ入れる（収入直前に未払いになる理不尽をなくす）
// v7: 領地収入（勢力の領地マス数 × 2G を、その勢力の君主の城の金庫へ）
Object.keys(FACTIONS).forEach(k => {
const fid = Number(k);
if (fid === 0) return;
const tiles = countTerritory(fid);
if (tiles === 0) return;
let ruler = null;
let rulerCastle = null;
gameState.castles.filter(c => c.factionId === fid).forEach(c => {
const l = getCastleLord(c.id);
if (l && (!ruler || l.merit > ruler.merit)) { ruler = l; rulerCastle = c; }
});
if (ruler && rulerCastle) {
const farms = countFarmland(fid); // v8: 農地マスは追加で +1G/マス
// v9: 豊穣の城を持つ勢力は農地収入+1、秋は収穫でさらに+1、君主の城が交易なら領地収入1.5倍
const hasHarvest = gameState.castles.some(c => c.factionId === fid && c.specialty === 'harvest');
const farmRate = 1 + (hasHarvest ? 1 : 0) + (getSeason(gameState.day).id === 'autumn' ? 1 : 0);
let gain = tiles * TERRITORY_INCOME_PER_TILE + farms * farmRate;
if (rulerCastle.specialty === 'trade') gain = Math.floor(gain * 1.5);
rulerCastle.treasury += gain;
if (isHuman(ruler)) addLog(`領地収入: ${tiles}マス × ${TERRITORY_INCOME_PER_TILE}G${farms ? ` + 農地${farms}マス × ${farmRate}G` : ''}${rulerCastle.specialty === 'trade' ? '（交易の城 +50%）' : ''} = +${gain}G が ${rulerCastle.name} の金庫に入りました。`, 'good');
}
});


gameState.castles.forEach(castle => {
const income = castle.economy * 2;
castle.treasury += income;

// v2: 私兵の維持費（城兵力合計の2パーセント）を月次で差し引く
const upkeep = Math.floor(getCastleTroops(castle.id) * 0.02);
if (upkeep > 0) {
const paidUpkeep = Math.min(Math.max(castle.treasury, 0), upkeep);
castle.treasury -= paidUpkeep;
const playerHere = getCastleOfficers(castle.id).some(m => isHuman(m));
if (playerHere) {
addLog(`${castle.name}の収支: 収入 +${income}G / 私兵維持費 -${paidUpkeep}G`, 'info');
}
}

const members = getCastleOfficers(castle.id);
if (members.length === 0) return;

const lord = members[0];
members.forEach(member => {
const salary = calcSalary(member.merit);
if (castle.treasury >= salary) {
castle.treasury -= salary;
member.gold += salary;
if (member.id!== lord.id) {
member.loyalty = Math.min(100, member.loyalty + 2);
}
if (isHuman(member)) {
addLog(`${member.name}に${castle.name}から給料 ${salary}G が支給されました。`, 'good');
}
} else {
const unpaidPenalty = loyaltyLossFor(member, 28);
member.loyalty = Math.max(0, member.loyalty - unpaidPenalty);
if (isHuman(member)) {
addLog(`${castle.name}の資金が枯渇し、${member.name}への給料が未払いとなりました！（忠誠-${unpaidPenalty}）`, 'danger');
} else if (lord && isHuman(lord)) {
addLog(`配下 ${member.name} への給料が払えず不満が爆発しています！（忠誠:${member.loyalty}）`, 'danger');
}
}
});

updateRebellionWarnings(castle);
});

runWorldEvent();
maybeVisitor();
}

// v9 stage E: 行軍中のNPCの個人フェイズ（野営訓練のみ。部隊を鍛える）
function executeNpcMarchPersonal(npc) {
    const army = gameState.armies.find(a => a.commanderId === npc.id);
    if (!army) return;
    if (army.type === 'ATTACK') {
        army.troops += calcTrainGain({ troops: army.troops, leadership: npc.leadership, trait: npc.trait });
    } else {
        npc.troops = (npc.troops || 0) + calcTrainGain(npc);
    }
}

// v9 stage E: 行軍中の野営訓練（プレイヤー用）。部隊の兵を増やし、武勇と統率が育つ
function doFieldTrainWork(officer, army) {
    const base = army.type === 'ATTACK' ? army.troops : (officer.troops || 0);
    const gain = calcTrainGain({ troops: base, leadership: officer.leadership, trait: officer.trait });
    if (army.type === 'ATTACK') army.troops += gain; else officer.troops = (officer.troops || 0) + gain;
    gainOfficerExp(officer, 'valor', 10);
    gainOfficerExp(officer, 'leadership', 10);
    addLog(`${officer.name}は行軍中の野営で訓練を行い、兵が +${gain} 増えました。`, 'good');
}

function actionFieldTrain() {
    if (netGuestGate('actionFieldTrain', [])) return;
    const player = getPlayer();
    if (!player || !player.isMoving) return;
    const army = gameState.armies.find(a => a.commanderId === player.id);
    if (!army) return;
    if ((player.gold || 0) < FIELD_TRAIN_COST_G) { addLog(`野営訓練には ${FIELD_TRAIN_COST_G}G が必要です（所持金不足）。`, 'warn'); updateUI(); return; }
    player.gold -= FIELD_TRAIN_COST_G;
    doFieldTrainWork(player, army);
    refreshPhasePanel();
}

// v9 stage E: 兵站整備（部隊ごとに1回まで。到着時の攻城戦で攻撃力+10%）
function actionSupplyPrep() {
    if (netGuestGate('actionSupplyPrep', [])) return;
    const player = getPlayer();
    if (!player || !player.isMoving) return;
    const army = gameState.armies.find(a => a.commanderId === player.id && a.type === 'ATTACK');
    if (!army || army.supplyReady) return;
    if ((player.gold || 0) < SUPPLY_COST_G) { addLog(`兵站整備には ${SUPPLY_COST_G}G が必要です（所持金不足）。`, 'warn'); updateUI(); return; }
    player.gold -= SUPPLY_COST_G;
    army.supplyReady = true;
    addLog(`${player.name}は兵站を整備しました。到着時の攻城戦で攻撃力が上がります。`, 'good');
    refreshPhasePanel();
}

function executeNpcPersonalPhase(npc) {
if (npc.castleId === null) {
const candidates = gameState.castles.filter(c => getCastleOfficers(c.id).length < MAX_CASTLE_OFFICERS);
if (candidates.length > 0) {
const target = candidates[Math.floor(Math.random() * candidates.length)];
npc.castleId = target.id;
npc.loyalty = 80;
addLog(`浪人 ${npc.name} が ${target.name} に仕官しました。`, 'info');
syncCastleLords();
}
return;
}

const castle = gameState.castles.find(c => c.id === npc.castleId);
if (castle) {
// v2: NPCも訓練で私兵を育てる（4割）。残りは内政（経済は上限で逓減）
if (Math.random() < 0.4) {
npc.troops = (npc.troops || 0) + calcTrainGain(npc);
} else {
const ecoGain = calcEcoGain(Math.max(3, Math.floor(npc.intellect / 18)) * (npc.trait === 'domestic' ? 1.3 : 1.0), castle);
const meritGain = meritGainFor(npc, Math.max(12, Math.floor(npc.intellect / 3.5)));
castle.economy = Math.min(ECONOMY_MAX, castle.economy + ecoGain);
npc.merit += meritGain;
}
}
}

function executeNpcStrategyPhase(lord) {
const castle = gameState.castles.find(c => c.id === lord.castleId);
if (!castle) return;

const members = getCastleOfficers(castle.id).filter(m => m.id!== lord.id);
const lowLoyaltyMember = members.find(m => m.loyalty < 65);
if (lowLoyaltyMember && castle.treasury >= 120 && spendCommand(lord, COMMAND_COSTS.distribute)) {
castle.treasury -= 100;
lowLoyaltyMember.loyalty = Math.min(100, lowLoyaltyMember.loyalty + 20);
lowLoyaltyMember.gold += 50;
}

// v9: NPC城主も領地開発と緊急徴兵を使う（どちらも月1回まで）
const npcMonth = Math.floor((gameState.day - 1) / 30); // v9 review fix: 暦の月と揃える
if (castle.npcDevelopMonth !== npcMonth && castle.treasury >= 800 && getCommand(lord) >= COMMAND_COSTS.develop) { // v9 review fix: 月1回は城単位で数える
    const devTiles = [];
    gameState.territory.forEach((row, r) => row.forEach((v, q) => {
        if (v !== castle.factionId || getDevelopment(q, r) !== 0) return;
        if (gameState.castles.some(c => c.q === q && c.r === r)) return;
        if (calcDistance(castle.q, castle.r, q, r) > 6) return; // v9 review fix: 距離判定を他と揃える
        let border = false;
        for (let dr = -1; dr <= 1 && !border; dr++) for (let dq = -1; dq <= 1; dq++) {
            const nq = q + dq, nr = r + dr;
            if (nq < 0 || nr < 0 || nq >= MAP_COLS || nr >= MAP_ROWS) continue;
            const nv = gameState.territory[nr][nq];
            if (nv !== 0 && nv !== castle.factionId) { border = true; break; }
        }
        devTiles.push({ q, r, border });
    }));
    const devPick = devTiles.find(t => t.border) || devTiles[0];
    if (devPick) {
        const kind = devPick.border ? 2 : 1;
        const goldCost = DEVELOP_COSTS[kind] || 0;
        if (castle.treasury >= goldCost && spendCommand(lord, COMMAND_COSTS.develop)) {
            castle.treasury -= goldCost;
            setDevelopment(devPick.q, devPick.r, kind);
            castle.npcDevelopMonth = npcMonth;
            addLog(`${castle.name}の領地 (${devPick.q}, ${devPick.r}) に${kind === 1 ? '農地' : '関所'}が開発されました。`, 'info');
        }
    }
}
if (castle.npcLevyMonth !== npcMonth && castle.treasury >= 600) {
    let strongestEnemy = 0;
    gameState.castles.forEach(c => {
        if (c.factionId !== castle.factionId && calcDistance(castle.q, castle.r, c.q, c.r) <= 8) strongestEnemy = Math.max(strongestEnemy, getCastleTroops(c.id));
    });
    if (strongestEnemy > 0 && getCastleTroops(castle.id) < strongestEnemy && spendCommand(lord, COMMAND_COSTS.emergencyLevy)) {
        castle.treasury -= 450;
        lord.troops = (lord.troops || 0) + 800;
        castle.npcLevyMonth = npcMonth;
        addLog(`${castle.name}で緊急徴兵が行われ、${lord.name}の私兵が増えました。`, 'info');
        return;
    }
}

// v9 stage F: NPCも支砦を建てる（月1回まで。資金に余裕があり、敵城が8マス以内にある城だけ。最も敵に近い有効マスへ）
if (castle.npcFortMonth !== npcMonth && castle.treasury >= 1200 && fortsOfCastle(castle.id, castle.factionId).length < FORT_MAX_PER_CASTLE && getCastleTroops(castle.id) >= FORT_GARRISON + 800) {
    const npcEnemies = gameState.castles.filter(c => c.factionId !== castle.factionId);
    const nearestEnemy = npcEnemies.reduce((m, e) => Math.min(m, calcDistance(castle.q, castle.r, e.q, e.r)), Infinity);
    if (nearestEnemy <= 8) {
        let bestFortTile = null;
        let bestFortScore = Infinity;
        for (let fr = 0; fr < MAP_ROWS; fr++) for (let fq = 0; fq < MAP_COLS; fq++) {
            if (!canBuildFort(lord, fq, fr)) continue;
            const score = npcEnemies.reduce((m, e) => Math.min(m, calcDistance(fq, fr, e.q, e.r)), Infinity);
            if (score < bestFortScore) { bestFortScore = score; bestFortTile = { q: fq, r: fr }; }
        }
        if (bestFortTile && spendCommand(lord, COMMAND_COSTS.fort)) {
            const npcFortCost = fortBuildCost(castle);
            castle.treasury -= npcFortCost;
            if (buildFortAt(castle, bestFortTile.q, bestFortTile.r)) {
                castle.npcFortMonth = npcMonth;
                addLog(`${castle.name}が前線の (${bestFortTile.q}, ${bestFortTile.r}) に支砦を建設しました。`, 'info');
            } else { castle.treasury += npcFortCost; lord.command = (lord.command || 0) + COMMAND_COSTS.fort; } // Copilot指摘: 失敗時は返還
        }
    }
}

// v2: 徴兵は城プールではなく城主自身の私兵を増やす
if (!isMarchingLord(lord) && (lord.troops || 0) < 2600 && castle.treasury >= 200 && spendCommand(lord, COMMAND_COSTS.recruit)) { // v9 stage E review fix: 行軍中の城主は徴兵しない
castle.treasury -= 150;
lord.troops = (lord.troops || 0) + 400;
return;
}

// v7: 出陣の間引きは指導力コスト（200）が担う（城兵力3200以上、前回から45日以上、戦力が見合う相手だけ）
const castleTroops = getCastleTroops(castle.id);
const sinceLast = gameState.day - (typeof castle.lastNpcAttackDay === 'number'? castle.lastNpcAttackDay: -999);
if (castleTroops >= 3200 && sinceLast >= 45 && getCommand(lord) >= COMMAND_COSTS.attack) {
const faction = FACTIONS[castle.factionId];
let targetCastle = null;
let chosenPlan = null;
let chosenCommander = null;

const commanderCandidates = (members.length > 0? [members[0], lord]: [lord]).filter(o => o && !o.isMoving); // v9 stage E: 行軍中は指揮官にできない
const tryTarget = (candidate) => {
if (!candidate || candidate.factionId === castle.factionId) return false;
if (calcDistance(castle.q, castle.r, candidate.q, candidate.r) > 8) return false;
for (const cmd of commanderCandidates) {
const plan = planExpedition(castle, cmd);
if (plan.total >= 300 && plan.total >= (getCastleTroops(candidate.id) + 100) * getSiegeBuff(candidate) * castleDefenseFactor(candidate) * 0.8) {
targetCastle = candidate;
chosenPlan = plan;
chosenCommander = cmd;
return true;
}
}
return false;
};

if (faction && faction.targetCastleId) {
const policyTarget = gameState.castles.find(c => c.id === faction.targetCastleId && c.factionId!== castle.factionId);
if (policyTarget) tryTarget(policyTarget);
}

if (!targetCastle) {
const enemies = gameState.castles.filter(c => c.factionId!== castle.factionId);
enemies.sort((a, b) => calcDistance(castle.q, castle.r, a.q, a.r) - calcDistance(castle.q, castle.r, b.q, b.r));
for (const e of enemies) {
if (tryTarget(e)) break;
}
}

if (targetCastle && chosenPlan && chosenCommander) {
chosenPlan.contributions.forEach(c => {
const o = gameState.officers.find(x => x.id === c.officerId);
if (o) o.troops = Math.max(0, (o.troops || 0) - c.amount);
});
const travel = calcTravelInfo(castle, targetCastle, chosenCommander);
chosenCommander.isMoving = true;
if (chosenCommander.id === lord.id) lord.nextStrategyDay = null;
castle.lastNpcAttackDay = gameState.day;
lord.command = getCommand(lord) - COMMAND_COSTS.attack;

gameState.armies.push({
id: 'army_' + Date.now() + Math.random(),
type: 'ATTACK',
factionId: castle.factionId,
originCastleId: castle.id,
targetCastleId: targetCastle.id,
commanderId: chosenCommander.id,
troops: chosenPlan.total,
contributions: chosenPlan.contributions,
q: castle.q,
r: castle.r,
totalDays: travel.days,
daysLeft: travel.days
});
initArmyRoute(gameState.armies[gameState.armies.length - 1]);
const npcArmy = gameState.armies[gameState.armies.length - 1];
// v9: NPCも戦力差で部隊方針を選ぶ（守備見積もりは実効守備力をそのまま使う）
const powerRatio = chosenPlan.total / Math.max(1, getEffectiveDefense(targetCastle));
npcArmy.stance = powerRatio >= 1.2 ? 'assault' : (powerRatio <= 0.9 ? 'guard' : 'balanced');
// v9: NPCも長距離なら強行軍を使う
let npcForced = false;
if (travel.days >= 5 && spendCommand(lord, COMMAND_COSTS.forcedMarch)) {
    npcArmy.forcedUntil = gameState.day + 3;
    if (npcArmy.path && npcArmy.path.length) npcArmy.daysLeft = Math.max(1, estimateDaysForPath(npcArmy.path, chosenCommander, npcArmy.factionId, npcArmy.forcedUntil || 0));
    npcForced = true;
}

addLog(`${FACTIONS[castle.factionId].name}の ${chosenCommander.name} 隊（${chosenPlan.total}兵）が ${targetCastle.name} へ進軍開始（到着まで${npcArmy.daysLeft}日）`, 'warn');
if (npcForced) addLog(`${chosenCommander.name} 隊が強行軍を開始しました（3日間、移動力+2）。`, 'info'); // v9 review fix: 進軍開始ログの後に強行軍ログを出す
syncCastleLords();
}
}
}

// --- プレイヤー操作アクション ---

// --- v4 追加: プレイヤー交代 ---
function showHandover() {
    const p = gameState.pendingPhase;
    if (!p) return;
    const officer = gameState.officers.find(o => o.id === p.officerId);
    if (!officer) { gameState.pendingPhase = null; return; }
    gameState.viewOfficerId = officer.id;
    document.getElementById('handover-title').textContent = `${officer.name} の番です`;
    document.getElementById('handover-sub').textContent = p.type === 'STRATEGY' ? '戦略フェイズ（城主特権）' : '個人フェイズ';
    document.getElementById('handover-overlay').classList.remove('hidden');
    updateUI();
}

function beginHumanPhase() {
    if (gameState.netMode === 'guest') { if (netHostConn) { try { netHostConn.send({ type: 'begin' }); } catch (e) { /* noop */ } } return; }
    const p = gameState.pendingPhase;
    if (!p) return;
    const officer = gameState.officers.find(o => o.id === p.officerId);
    gameState.pendingPhase = null;
    document.getElementById('handover-overlay').classList.add('hidden');
    if (!officer) return;
    gameState.activeOfficerId = officer.id;
    gameState.viewOfficerId = officer.id;
    gameState.activePhase = p.type;
    addLog(`${officer.name}の【${p.type === 'STRATEGY' ? '戦略' : '個人'}フェイズ】が到来しました。`, 'phase');
    if (p.type === 'PERSONAL') maybePersonalEvent(officer);
    updateUI();
    drawMap();
    netSync();
}

function finishPlayerPhase() {
// v7: ゲストのフェイズ終了はホストへ通知して初めて成立する（以前はローカルで消えるだけで進まなかった）
if (gameState.netMode === 'guest') {
if (netHostConn && netHostConn.open !== false) { try { netHostConn.send({ type: 'finish' }); } catch (e) { /* noop */ } }
return;
}
const finishedOfficer = gameState.officers.find(o => o.id === gameState.activeOfficerId);
const finishedPhaseType = gameState.activePhase;
gameState.activePhase = null;
gameState.activeOfficerId = null;
syncCastleLords();
// v7 review fix: an officer promoted to castle lord during their personal phase still gets a strategy phase this cycle
if (finishedOfficer && finishedPhaseType === 'PERSONAL' && finishedOfficer.nextStrategyDay === null && (isCastleLord(finishedOfficer) || isMarchingLord(finishedOfficer))) { // v9 stage E review fix: 行軍中の城主にも補完する
finishedOfficer.nextStrategyDay = gameState.day + Math.floor(calcActionInterval(finishedOfficer) / 2);
}
updateUI();
drawMap();
checkPlayerStatusEvents();
saveGame();
netSync();
startAutoTimer();
}

function actionEnlist(castleId) {
    if (netGuestGate('actionEnlist', [castleId])) return;
    const player = getPlayer();
    const castle = gameState.castles.find(c => c.id === castleId);
    if (!castle) return;

    const currentMembers = getCastleOfficers(castle.id);
    if (currentMembers.length >= MAX_CASTLE_OFFICERS) {
        addLog(`${castle.name}は定員に達しており仕官できませんでした。`, 'warn');
        return;
    }

    player.castleId = castle.id;
    player.loyalty = 85;
    addLog(`${castle.name}への仕官が認められました！`, 'good');
    closeModal();
    finishPlayerPhase();
}

// v7: 内政の実処理（個人・戦略共通）。コストは呼び出し側で払う
function doDomesticWork(player) {
const castle = gameState.castles.find(c => c.id === player.castleId);
if (!castle) return;
const ecoGain = calcEcoGain(Math.max(5, Math.floor(player.intellect / 12)) * (player.trait === 'domestic' ? 1.3 : 1.0), castle);
// v7 review fix: domestic work with zero effect (economy already capped) grants no merit either
const meritGain = ecoGain === 0 ? 0 : meritGainFor(player, Math.max(20, Math.floor(player.intellect / 2.2)));
castle.economy = Math.min(ECONOMY_MAX, castle.economy + ecoGain);
player.merit += meritGain;
if (ecoGain === 0) {
addLog(`${castle.name}で内政を実施しましたが、経済は上限（${ECONOMY_MAX}）に達しており効果がありませんでした。`, 'warn');
} else {
addLog(`${castle.name}で内政を実施。城の経済 +${ecoGain}、功績 +${meritGain}pt！`, 'good');
}
gainOfficerExp(player, 'intellect', 20); // v8: 内政で知力が育つ
syncCastleLords();
}

function actionDomesticAffairs() {
    if (netGuestGate('actionDomesticAffairs', [])) return;
    const player = getPlayer();
    if (!player || player.castleId === null) return;
    const homeCastleD = gameState.castles.find(c => c.id === player.castleId);
    if (homeCastleD && homeCastleD.economy >= ECONOMY_MAX) { addLog(`${homeCastleD.name}の経済は既に上限（${ECONOMY_MAX}）です。内政の必要はありません。`, 'warn'); updateUI(); return; }
    if ((player.gold || 0) < DOMESTIC_COST_G) { addLog(`内政には ${DOMESTIC_COST_G}G が必要です（所持金不足）。`, 'warn'); updateUI(); return; }
    player.gold -= DOMESTIC_COST_G;
    doDomesticWork(player);
    refreshPhasePanel();
}

// v7: 戦略フェイズでも内政ができる（金＋指導力）
function actionStrategyDomestic() {
    if (netGuestGate('actionStrategyDomestic', [])) return;
    const player = getPlayer();
    if (!player || player.castleId === null) return;
    const homeCastleS = gameState.castles.find(c => c.id === player.castleId);
    if (homeCastleS && homeCastleS.economy >= ECONOMY_MAX) { addLog(`${homeCastleS.name}の経済は既に上限（${ECONOMY_MAX}）です。内政の必要はありません。`, 'warn'); updateUI(); return; }
    if ((player.gold || 0) < DOMESTIC_COST_G) { addLog(`内政には ${DOMESTIC_COST_G}G が必要です（所持金不足）。`, 'warn'); updateUI(); return; }
    if (!spendCommand(player, COMMAND_COSTS.domestic)) { addLog(`指導力が不足しています（内政には ${COMMAND_COSTS.domestic} 必要）。`, 'warn'); updateUI(); return; }
    player.gold -= DOMESTIC_COST_G;
    doDomesticWork(player);
    refreshPhasePanel();
}

// v2: 訓練（仕様4.2）。自分の私兵を直接強化する。少ないうちほど伸びが大きい
// v7: 訓練の実処理（個人・戦略共通）
function doTrainWork(player) {
const gain = calcTrainGain(player);
player.troops = (player.troops || 0) + gain;
gainOfficerExp(player, 'valor', 10); // v8: 訓練で武勇と統率が育つ
gainOfficerExp(player, 'leadership', 10);
addLog(`私兵を訓練し、兵力が +${gain} 増えました（現在 ${player.troops} 兵）。`, 'good');
}

function actionTrain() {
    if (netGuestGate('actionTrain', [])) return;
const player = getPlayer();
if (!player || player.castleId === null) return;
if ((player.gold || 0) < TRAIN_COST_G) { addLog(`訓練には ${TRAIN_COST_G}G が必要です（所持金不足）。`, 'warn'); updateUI(); return; }
player.gold -= TRAIN_COST_G;
doTrainWork(player);
refreshPhasePanel();
}

// v7: 戦略フェイズの訓練（金＋指導力）
function actionStrategyTrain() {
    if (netGuestGate('actionStrategyTrain', [])) return;
    const player = getPlayer();
    if (!player || player.castleId === null) return;
    if ((player.gold || 0) < TRAIN_COST_G) { addLog(`訓練には ${TRAIN_COST_G}G が必要です（所持金不足）。`, 'warn'); updateUI(); return; }
    if (!spendCommand(player, COMMAND_COSTS.train)) { addLog(`指導力が不足しています（訓練には ${COMMAND_COSTS.train} 必要）。`, 'warn'); updateUI(); return; }
    player.gold -= TRAIN_COST_G;
    doTrainWork(player);
    refreshPhasePanel();
}

function actionRelocate(targetCastleId) {
    if (netGuestGate('actionRelocate', [targetCastleId])) return;
const player = getPlayer();
const origin = gameState.castles.find(c => c.id === player.castleId);
const target = gameState.castles.find(c => c.id === targetCastleId);
if (!origin ||!target) return;

const travel = calcTravelInfo(origin, target, player);
const travelDays = travel.days;

player.isMoving = true;
player.nextStrategyDay = null;

gameState.armies.push({
id: 'move_' + Date.now(),
type: 'RELOCATE',
factionId: origin.factionId,
originCastleId: origin.id,
targetCastleId: target.id,
commanderId: player.id,
troops: 0,
q: origin.q,
r: origin.r,
totalDays: travelDays,
daysLeft: travelDays
});
initArmyRoute(gameState.armies[gameState.armies.length - 1]);

addLog(`${target.name}へ向けて移動を開始しました（到着まで${travelDays}日）。`, 'info');
closeModal();
finishPlayerPhase();
}

function actionBribeSabotage(targetCastleId) {
    if (netGuestGate('actionBribeSabotage', [targetCastleId])) return;
    const player = getPlayer();
    const cost = 120;
    if (player.gold < cost) return;

    const targetCastle = gameState.castles.find(c => c.id === targetCastleId);
    if (!targetCastle) return;

    player.gold -= cost;
    const members = getCastleOfficers(targetCastle.id);
    const subordinates = members.slice(1);

    if (subordinates.length === 0) {
        addLog(`${targetCastle.name}に工作を仕掛けましたが目立った配下がいませんでした。`, 'warn');
    } else {
        const drop = 18 + Math.floor(player.intellect / 6);
        subordinates.forEach(s => {
            s.loyalty = Math.max(0, s.loyalty - drop);
        });
        addLog(`【資金工作】私財 ${cost}G を投じ、${targetCastle.name}の配下の不満を煽りました！（忠誠 -${drop}）`, 'good');
        updateRebellionWarnings(targetCastle);
    }

    closeModal();
    finishPlayerPhase();
}

// v8: 兵科変更（個人フェイズ、仕官中のみ、私財から）
function actionChangeTroopType(type) {
    if (netGuestGate('actionChangeTroopType', [type])) return;
    const player = getPlayer();
    if (!player || player.castleId === null) return;
    if (!TROOP_TYPES[type] || getTroopType(player) === type) return;
    if ((player.gold || 0) < TROOP_TYPE_CHANGE_COST) { addLog(`兵科変更には ${TROOP_TYPE_CHANGE_COST}G が必要です（所持金不足）。`, 'warn'); updateUI(); return; }
    player.gold -= TROOP_TYPE_CHANGE_COST;
    player.troopType = type;
    addLog(`${player.name} の兵科を ${TROOP_TYPES[type].name} に変更しました。`, 'good');
    refreshPhasePanel();
}

function actionResign() {
    if (netGuestGate('actionResign', [])) return;
    const player = getPlayer();
    const oldMerit = player.merit;
    player.castleId = null;
    player.merit = Math.floor(oldMerit * 0.5);
    player.nextStrategyDay = null;

    addLog(`下野して浪人となりました（功績半減: ${oldMerit}pt → ${player.merit}pt）。`, 'warn');
    closeModal();
    finishPlayerPhase();
}

function actionRecruit() {
    if (netGuestGate('actionRecruit', [])) return;
const player = getPlayer();
if (!player) return;
const castle = gameState.castles.find(c => c.id === player.castleId);
const cost = 150;
if (!castle || castle.treasury < cost) return;
if (!spendCommand(player, COMMAND_COSTS.recruit)) { addLog(`指導力が不足しています（徴兵には ${COMMAND_COSTS.recruit} 必要）。`, 'warn'); updateUI(); return; }

castle.treasury -= cost;
player.troops = (player.troops || 0) + 400;
addLog(`${castle.name}の共有資金で自分の私兵を 400 徴兵しました（現在 ${player.troops} 兵）。`, 'good');
refreshPhasePanel();
}

// v8: 緊急徴兵（城主特権。通常徴兵より割高だが一度に多く、個人フェイズでも使える）
function actionEmergencyLevy() {
    if (netGuestGate('actionEmergencyLevy', [])) return;
    const player = getPlayer();
    if (!player) return;
    if (!isCastleLord(player) && !isMarchingLord(player)) return; // v9 stage E: 行軍中の城主も伝令で徴兵できる
    if (player.isMoving && gameState.activePhase !== 'STRATEGY') return; // v9 stage E review fix: 伝令の緊急徴兵は戦略フェイズでのみ
    const castle = gameState.castles.find(c => c.id === player.castleId);
    const cost = 450;
    if (!castle || castle.treasury < cost) return;
    if (!spendCommand(player, COMMAND_COSTS.emergencyLevy)) { addLog(`指導力が不足しています（緊急徴兵には ${COMMAND_COSTS.emergencyLevy} 必要）。`, 'warn'); updateUI(); return; }
    castle.treasury -= cost;
    player.troops = (player.troops || 0) + 800;
    addLog(`${castle.name}で緊急徴兵を行い、自分の私兵を 800 増やしました（現在 ${player.troops} 兵）。`, 'good');
    refreshPhasePanel();
}

// v8: 強行軍（出撃元城主が指導力を払い、部隊の移動力を3日間 +2 する）
function canForceMarch(army, officer) {
    if (!army || !officer || army.type !== 'ATTACK') return false;
    if (army.forcedUntil && gameState.day <= army.forcedUntil) return false;
    const origin = gameState.castles.find(c => c.id === army.originCastleId);
    if (!origin || origin.factionId !== army.factionId) return false;
    if ((!isCastleLord(officer) && !isMarchingLord(officer)) || officer.castleId !== origin.id) return false; // v9 stage E review fix: 行軍中の城主も強行軍を命じられる
    return getCommand(officer) >= COMMAND_COSTS.forcedMarch;
}
function actionForcedMarch(armyId) {
    if (gameState.netMode === 'guest') {
        if (netHostConn && netHostConn.open) netHostConn.send({ type: 'forced-march', armyId });
        return;
    }
    if (isHostRemoteLock()) return;
    const army = gameState.armies.find(a => a.id === armyId);
    const officer = getPlayer();
    if (!army || !officer || !canForceMarch(army, officer)) return;
    if (!spendCommand(officer, COMMAND_COSTS.forcedMarch)) return;
    army.forcedUntil = gameState.day + 3;
    const commander = gameState.officers.find(o => o.id === army.commanderId);
    if (army.path && army.path.length) army.daysLeft = Math.max(1, estimateDaysForPath(army.path, commander, army.factionId, army.forcedUntil || 0)); // v8/v9: 到着予測にも強行軍を反映（期間内のみ）
    addLog(`${commander ? commander.name : '部隊'} 隊が強行軍を開始しました（3日間、移動力+2）。`, 'good');
    saveGame();
    netSync();
    updateUI();
    drawMap();
}

// v8: 領地開発（自勢力の領地マスに農地か関所を置く。払うのは自分の城の金庫と自分の指導力）
const DEVELOP_COSTS = { 1: 200, 2: 300 };
function canDevelopTile(officer, q, r) {
    if (!Number.isInteger(q) || !Number.isInteger(r) || q < 0 || q >= MAP_COLS || r < 0 || r >= MAP_ROWS) return false; // v8 review fix: 座標の型と範囲を検証する
    if (!officer || (!isCastleLord(officer) && !isMarchingLord(officer))) return false; // v9 stage E: 行軍中の城主も伝令で開発できる
    if (gameState.castles.some(c => c.q === q && c.r === r)) return false;
    if (fortAt(q, r)) return false; // v9 stage F: 支砦のあるマスは開発できない
    const castle = gameState.castles.find(c => c.id === officer.castleId);
    if (!castle) return false;
    if (getTerritory(q, r) !== castle.factionId) return false;
    if (getDevelopment(q, r) !== 0) return false;
    return true;
}
function actionDevelopTile(q, r, kind) {
    if (gameState.netMode === 'guest') {
        if (netHostConn && netHostConn.open) netHostConn.send({ type: 'develop', q, r, kind });
        return;
    }
    if (isHostRemoteLock()) return;
    const officer = getPlayer();
    if (!officer || !canDevelopTile(officer, q, r)) return;
    const castle = gameState.castles.find(c => c.id === officer.castleId);
    const goldCost = DEVELOP_COSTS[kind] || 0;
    if (!castle || castle.treasury < goldCost) { addLog('共有資金が不足しています。', 'warn'); return; }
    if (!spendCommand(officer, COMMAND_COSTS.develop)) { addLog(`指導力が不足しています（領地開発には ${COMMAND_COSTS.develop} 必要）。`, 'warn'); updateUI(); return; }
    castle.treasury -= goldCost;
    setDevelopment(q, r, kind);
    addLog(`${castle.name}の領地 (${q}, ${r}) に${kind === 1 ? '農地' : '関所'}を開発しました。`, 'good');
    saveGame();
    netSync();
    updateUI();
    drawMap();
    if (typeof renderSelectedTile === 'function') renderSelectedTile();
}

// v9 stage F: 支砦（前線拠点）。城から FORT_BUILD_RANGE 以内の自領地に建て、半径 FORT_RADIUS の領地アンカーになる。
const FORT_COSTS = [400, 700]; // 1つ目 / 2つ目の建設費（城の共有資金から）
function fortsOfCastle(castleId, factionId) {
    return (gameState.forts || []).filter(f => f.homeCastleId === castleId && (factionId === undefined || f.factionId === factionId));
}
function fortBuildCost(castle) {
    const n = fortsOfCastle(castle.id, castle.factionId).length;
    return FORT_COSTS[Math.min(n, FORT_COSTS.length - 1)];
}
function canBuildFort(officer, q, r) {
    if (!Number.isInteger(q) || !Number.isInteger(r) || q < 0 || q >= MAP_COLS || r < 0 || r >= MAP_ROWS) return false;
    if (!officer || (!isCastleLord(officer) && !isMarchingLord(officer))) return false; // 城主（行軍中は伝令）だけが建てられる
    const castle = gameState.castles.find(c => c.id === officer.castleId);
    if (!castle) return false;
    const d = calcDistance(castle.q, castle.r, q, r);
    if (d === 0 || d > FORT_BUILD_RANGE) return false;
    if (getTerritory(q, r) !== castle.factionId) return false; // 自勢力の色のマスだけ
    if (gameState.castles.some(c => c.q === q && c.r === r)) return false;
    if (fortAt(q, r)) return false;
    if (getDevelopment(q, r) !== 0) return false; // 施設のあるマスには建てられない
    const cell = gameState.mapGrid[r] && gameState.mapGrid[r][q];
    if (cell && cell.terrain && cell.terrain.id === 3) return false; // 河川には建てられない
    if (gameState.armies.some(a => a.factionId !== castle.factionId && a.posQ === q && a.posR === r)) return false; // 敵部隊のいるマスには建てられない
    if (fortsOfCastle(castle.id, castle.factionId).length >= FORT_MAX_PER_CASTLE) return false;
    return true;
}
// 城の駐留兵から amount を兵力の多い順に差し引く。総兵力が足りなければ何もせず false
function deductCastleTroops(castleId, amount) {
    const members = getCastleOfficers(castleId).slice().sort((a, b) => (b.troops || 0) - (a.troops || 0));
    if (members.reduce((s, o) => s + (o.troops || 0), 0) < amount) return false;
    let left = amount;
    for (const o of members) {
        const take = Math.min(o.troops || 0, left);
        o.troops = (o.troops || 0) - take;
        left -= take;
        if (left <= 0) break;
    }
    return true;
}
// 支払い済みの前提で支砦を実体化する（プレイヤー・NPC・オンラインの共通処理）
function buildFortAt(castle, q, r) {
    if (!deductCastleTroops(castle.id, FORT_GARRISON)) return null;
    const fort = { id: 'fort_' + Date.now() + '_' + Math.floor(Math.random() * 1e6), q, r, factionId: castle.factionId, homeCastleId: castle.id, garrison: FORT_GARRISON };
    if (!Array.isArray(gameState.forts)) gameState.forts = [];
    gameState.forts.push(fort);
    recomputeTerritory();
    return fort;
}
function actionBuildFort(q, r) {
    if (gameState.netMode === 'guest') {
        if (netHostConn && netHostConn.open) netHostConn.send({ type: 'fort', q, r });
        return;
    }
    if (isHostRemoteLock()) return;
    const officer = getPlayer();
    if (!officer || !canBuildFort(officer, q, r)) return;
    const castle = gameState.castles.find(c => c.id === officer.castleId);
    const cost = fortBuildCost(castle);
    if (!castle || castle.treasury < cost) { addLog('共有資金が不足しています。', 'warn'); return; }
    if (getCastleTroops(castle.id) < FORT_GARRISON) { addLog(`支砦の守備に割く兵力が不足しています（城の駐留 ${FORT_GARRISON} 兵が必要）。`, 'warn'); return; }
    if (!spendCommand(officer, COMMAND_COSTS.fort)) { addLog(`指導力が不足しています（支砦建設には ${COMMAND_COSTS.fort} 必要）。`, 'warn'); updateUI(); return; }
    castle.treasury -= cost;
    const builtFort = buildFortAt(castle, q, r);
    if (!builtFort) { castle.treasury += cost; officer.command = (officer.command || 0) + COMMAND_COSTS.fort; addLog('支砦の建設に失敗しました（資金と指導力は返還されました）。', 'warn'); updateUI(); return; } // Copilot指摘: 失敗時に資源だけ失われないように
    addLog(`${castle.name}の支砦を (${q}, ${r}) に建設しました（守備 ${FORT_GARRISON} 兵）。周辺の領地が自勢力に固まりました。`, 'good');
    saveGame();
    netSync();
    updateUI();
    drawMap();
    if (typeof renderSelectedTile === 'function') renderSelectedTile();
}

function actionDistributeFunds() {
    if (netGuestGate('actionDistributeFunds', [])) return;
    const player = getPlayer();
    if (!player) return;
    const castle = gameState.castles.find(c => c.id === player.castleId);
    const cost = 150;
    if (!castle || castle.treasury < cost) return;

    const subordinates = getCastleOfficers(castle.id).filter(m => m.id !== player.id);
    if (subordinates.length === 0) return;
    if (!spendCommand(player, COMMAND_COSTS.distribute)) { addLog(`指導力が不足しています（資金分配には ${COMMAND_COSTS.distribute} 必要）。`, 'warn'); updateUI(); return; }

    castle.treasury -= cost;
    const share = Math.floor(cost / subordinates.length);
    subordinates.forEach(s => {
        s.gold += share;
        s.loyalty = Math.min(100, s.loyalty + 25);
    });

    addLog(`共有資金から ${cost}G を配下に分配し、忠誠心を回復させました！`, 'good');
    refreshPhasePanel();
}

function actionEmbezzle() {
    if (netGuestGate('actionEmbezzle', [])) return;
const player = getPlayer();
if (!player) return;
const castle = gameState.castles.find(c => c.id === player.castleId);
const amount = player.trait === 'wealth' ? 300 : 200;
if (!castle || castle.treasury < amount) return;
if (!spendCommand(player, COMMAND_COSTS.embezzle)) { addLog(`指導力が不足しています（横領には ${COMMAND_COSTS.embezzle} 必要）。`, 'warn'); updateUI(); return; }

castle.treasury -= amount;
player.gold += amount;

// v2: 横領そのものに罰則はないが、噂が広まり配下の忠誠が少し下がる
const subordinates = getCastleOfficers(castle.id).filter(m => m.id !== player.id);
subordinates.forEach(s => { s.loyalty = Math.max(0, s.loyalty - loyaltyLossFor(s, 4)); });

addLog(`${castle.name}の共有資金から ${amount}G を私財に引き出しました。（噂が広まり配下の忠誠 -4）`, 'warn');
// v7 review fix: embezzling converts shared funds into private gold, so it ends the strategy phase (pre-v7 behaviour; blocks same-phase conversion loops)
finishPlayerPhase();
}

function actionLaunchAttack(originCastleId, targetCastleId, commanderId, mode = 'strategy', dispatchTotal = null, stance = null, targetQ = null, targetR = null) {
    if (netGuestGate('actionLaunchAttack', [originCastleId, targetCastleId, commanderId, mode, dispatchTotal, stance, targetQ, targetR])) return;
    const stanceId = (stance && Object.prototype.hasOwnProperty.call(STANCES, stance)) ? stance : 'balanced'; // v9 review fix: 原型プロパティ（toString等）を不正値として弾く
    if (mode !== 'independent') mode = 'strategy'; // v9 review fix: 不正な mode でフェイズ確認と指導力コストを回避できないようにする
const origin = gameState.castles.find(c => c.id === originCastleId);
let target = gameState.castles.find(c => c.id === targetCastleId);
const commander = gameState.officers.find(o => o.id === commanderId);
// v9 stage F: マス目標（targetQ/targetR が両方そろった場合のみ有効。城マスを指定したらその城目標に読み替える）
let targetTile = null;
if (!target && Number.isInteger(targetQ) && Number.isInteger(targetR) && targetQ >= 0 && targetQ < MAP_COLS && targetR >= 0 && targetR < MAP_ROWS) {
const castleOnTile = gameState.castles.find(c => c.q === targetQ && c.r === targetR);
if (castleOnTile) target = castleOnTile;
else targetTile = { q: targetQ, r: targetR };
}
if (!origin || (!target && !targetTile) || !commander) return;
if (target && target.factionId === origin.factionId) return; // 同勢力の城は攻撃できない（モーダル側でも除外済み）
if (commander.castleId !== originCastleId || commander.isMoving) return; // 指揮官は出撃元の城に駐留する武将のみ（Copilotレビュー指摘）
// v7 review fix: inside a phase, the sortie must belong to the phase owner (no launching other castles' or other officers' armies)
if (gameState.activeOfficerId) {
if (mode === 'independent' && commanderId !== gameState.activeOfficerId) return;
if (mode === 'strategy') {
const activeOfficer = gameState.officers.find(o => o.id === gameState.activeOfficerId);
if (!activeOfficer || activeOfficer.castleId !== originCastleId) return;
}
}

// v7: 戦略出陣は指導力200を消費する（支払うのは戦略フェイズの主＝城主）
let commandPayer = null;
if (mode === 'strategy') {
commandPayer = gameState.officers.find(o => o.id === gameState.activeOfficerId) || commander;
if (!commandPayer || getCommand(commandPayer) < COMMAND_COSTS.attack) { addLog(`指導力が不足しています（出陣には ${COMMAND_COSTS.attack} 必要）。`, 'warn'); updateUI(); return; }
}

let contributions;
let sendTroops;
if (mode === 'independent') {
// 独立出陣: 自分の私兵から指定兵力で出る（未指定なら90パーセント）
if (typeof dispatchTotal === 'number' && isFinite(dispatchTotal)) sendTroops = Math.max(0, Math.min(commander.troops || 0, Math.round(dispatchTotal)));
else sendTroops = Math.floor((commander.troops || 0) * 0.9);
if (sendTroops < 300) return;
contributions = [{ officerId: commander.id, amount: sendTroops}];
} else {
const plan = (typeof dispatchTotal === 'number' && isFinite(dispatchTotal)) ? buildAdjustedPlan(origin, commander, dispatchTotal) : planExpedition(origin, commander);
contributions = plan.contributions;
sendTroops = plan.total;
if (sendTroops < 300) return;
}

if (commandPayer) commandPayer.command = getCommand(commandPayer) - COMMAND_COSTS.attack;

contributions.forEach(c => {
const o = gameState.officers.find(x => x.id === c.officerId);
if (o) o.troops = Math.max(0, (o.troops || 0) - c.amount);
});

const travel = calcTravelInfo(origin, target ? target : { q: targetTile.q, r: targetTile.r }, commander);

const topBefore = castleTopOfficer(origin.id); // 出陣前の筆頭判定（isMoving を立てた後は本人が候補から外れるため先に取る）
commander.isMoving = true;
if (gameState.activeOfficerId && commander.id === gameState.activeOfficerId) {
if (!topBefore || topBefore.id !== commander.id) commander.nextStrategyDay = null; // v9 stage E review fix: 行軍中の城主になる場合は伝令の戦略フェイズ用に予約を残す
}

gameState.armies.push({
id: 'atk_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
type: 'ATTACK',
stance: stanceId, // v9: 部隊方針
factionId: origin.factionId,
originCastleId: origin.id,
targetCastleId: target ? target.id : null,
targetTile: targetTile, // v9 stage F: マス目標（城目標のときは null）
commanderId: commander.id,
troops: sendTroops,
contributions,
q: origin.q,
r: origin.r,
totalDays: travel.days,
daysLeft: travel.days
});
initArmyRoute(gameState.armies[gameState.armies.length - 1]);

addLog(`${origin.name}より ${commander.name} 隊（${sendTroops}兵）が出撃！${targetTile ? `目標はマス (${targetTile.q}, ${targetTile.r})。` : ''}`, 'phase');
closeModal();
// v7: 指揮官本人が出る場合はフェイズ終了。城主が他人を派遣した場合は戦略フェイズを続行できる
if (mode === 'independent' || (commandPayer && commander.id === commandPayer.id)) {
finishPlayerPhase();
} else {
refreshPhasePanel();
}
}

function actionSetFactionPolicy(targetCastleId) {
    if (netGuestGate('actionSetFactionPolicy', [targetCastleId])) return;
    const player = getPlayer();
    if (!player) return;
    const castle = gameState.castles.find(c => c.id === player.castleId);
    if (!castle) return;

    if (!spendCommand(player, COMMAND_COSTS.policy)) { addLog(`指導力が不足しています（方針設定には ${COMMAND_COSTS.policy} 必要）。`, 'warn'); updateUI(); return; }
    FACTIONS[castle.factionId].targetCastleId = targetCastleId;
    const target = gameState.castles.find(c => c.id === targetCastleId);
    addLog(`【君主大方針】勢力全体の攻撃目標を「${target.name}」に設定しました！`, 'phase');
    closeModal();
    refreshPhasePanel();
}

function checkUnification() {
const activeFactions = new Set(gameState.castles.map(c => c.factionId));
// v2: 世界が再び分裂したら統一フラグを解除し、次の統一でも判定する
if (activeFactions.size > 1) {
gameState.unifiedAchieved = false;
return;
}
if (gameState.unifiedAchieved) return;
    if (activeFactions.size === 1) {
        const winnerFactionId = [...activeFactions][0];
        if (winnerFactionId === 0) return;

        gameState.unifiedAchieved = true;
        addChronicle(`${(FACTIONS[winnerFactionId] || {}).name || '不明勢力'} が天下を統一`, 'unify');
        showEventNotice('天下統一', `${FACTIONS[winnerFactionId].name}が天下を統一しました。`, 'warn', { big: true });
        pauseAutoTimer();

        const player = getPlayer();
        const playerCastle = gameState.castles.find(c => c.id === player.castleId);
        const humanWinners = gameState.officers.filter(o => isHuman(o) && o.castleId !== null && (gameState.castles.find(c => c.id === o.castleId) || {}).factionId === winnerFactionId); // v8 review fix: 行軍中の人間も所属城の勢力で判定する
        const isPlayerSideWin = humanWinners.length > 0;
        const winnerName = (FACTIONS[winnerFactionId] || {}).name || '不明勢力';

        showModal(
            isPlayerSideWin ? '祝・天下統一達成！' : '天下統一の成立',
            `<p class="text-base font-bold text-amber-400 mb-2">「${winnerName}」が全土を制圧しました！</p>
             <p>${isPlayerSideWin ? `${humanWinners.map(o => o.name).join('、')} の活躍により天下が統一されました。` : '他勢力によって天下が統一されました。'}</p>
             <div class="bg-slate-900 p-3 rounded border border-slate-700 mt-3 text-xs">
                <div class="font-bold text-purple-400 mb-1">★ エンドレスモード（黒幕プレイ）</div>
                <p>蓄積した私財（<strong>${player ? player.gold : 0}G</strong>）を使い、統一勢力に「資金工作」を仕掛けて内側から崩壊させることができます！</p>
             </div>
             <div class="bg-slate-900 p-3 rounded border border-slate-700 mt-3 text-xs">
                <div class="font-bold text-amber-300 mb-1">📜 戦績</div>
                ${typeof chronicleSummaryHtml === 'function' ? chronicleSummaryHtml() : ''}
             </div>`,
            [
                {
                    text: 'エンドレスモードで続ける',
                    class: 'bg-purple-600 hover:bg-purple-500 text-white font-bold',
                    onClick: () => {
                        gameState.endlessMode = true;
                        document.getElementById('endless-banner').classList.remove('hidden');
                        addLog('エンドレスモードに突入しました。資金工作で世界をかき乱しましょう！', 'phase');
                        closeModal();
                        updateUI();
                        netSync();
                    }
                }
            ]
        );
    }
}