// CHRONICLE OF BETRAYAL — battle.js: 野戦・攻城・反乱・出陣計画


// v6: 籠城バフ（内政に比例。内政0で+0%、上限300で+50%）
function getSiegeBuff(castle) {
    let buff = 1 + ((castle.economy || 0) / ECONOMY_MAX) * 0.5;
    if (typeof isEncircled === 'function' && isEncircled(castle)) buff *= 0.85; // v7: 包囲されると補給が断たれ籠城バフ低下
    return Math.max(0.9, buff); // v9: 下限0.9（低経済＋包囲で落ちやすさが極端にならないように）
}

// v9: 兵科の三すくみ（野戦のみ。有利な側が+10%）
function troopMatchupModifier(me, enemy) {
    if (!me || !enemy) return 1;
    const a = getTroopType(me), b = getTroopType(enemy);
    if ((a === 'cavalry' && b === 'archer') || (a === 'archer' && b === 'infantry') || (a === 'infantry' && b === 'cavalry')) return 1.1;
    return 1;
}

// v9: 部隊方針（未設定はバランス扱い）
function stanceOf(army) { const s = army && army.stance; return (s && Object.prototype.hasOwnProperty.call(STANCES, s)) ? STANCES[s] : STANCES.balanced; } // v9 review fix: 原型プロパティのすり抜けを防ぐ

// v9: 要塞の城は守備が1割増し
function castleDefenseFactor(castle) {
    return (castle && castle.specialty === 'fortress') ? 1.1 : 1;
}

// v6: 実効守備力（表示・NPC判定用。乱数なし）
// v8: 兵科倍率。field は地形、siege は歩兵のみ
function troopTypeModifier(officer, terrain, context) {
    if (!officer) return 1;
    const t = getTroopType(officer);
    if (context === 'field') {
        const tid = terrain ? terrain.id : 0;
        if (t === 'cavalry') {
            if (tid === 0) return 1.15;
            if (tid === 2 || tid === 3) return 0.85;
        }
        if (t === 'archer' && tid === 1) return 1.15;
        return 1;
    }
    if (context === 'siege-attack' || context === 'siege-defense') {
        return t === 'infantry' ? 1.10 : 1;
    }
    return 1;
}

function getEffectiveDefense(castle) {
    const lord = getCastleLord(castle.id);
    const defValor = lord ? lord.valor : 55;
    let eff = (getCastleTroops(castle.id) + 100) * (1 + defValor / 100) * getSiegeBuff(castle) * castleDefenseFactor(castle); // v9: 要塞補正
    if (lord && lord.trait === 'ironwall') eff *= 1.15;
    if (lord) eff *= troopTypeModifier(lord, null, 'siege-defense'); // v8: 歩兵の城主は守備 +10%
    return Math.round(eff);
}

// 出撃の供出計画: 指揮官は私兵の全て、他の駐留武将は半分を供出する
function planExpedition(originCastle, commander) {
const members = getCastleOfficers(originCastle.id);
const contributions = [];
members.forEach(o => {
const amount = (o.id === commander.id)? (o.troops || 0): Math.floor((o.troops || 0) / 2);
if (amount > 0) contributions.push({ officerId: o.id, amount});
});
const total = contributions.reduce((s, c) => s + c.amount, 0);
return { contributions, total};
}

// v6: 出陣兵力の調整（指揮官優先で満額、残りを他武将の半分上限から按分）
function buildAdjustedPlan(originCastle, commander, desiredTotal) {
    const members = getCastleOfficers(originCastle.id);
    const caps = members.map(o => ({ officerId: o.id, cap: (o.id === commander.id) ? (o.troops || 0) : Math.floor((o.troops || 0) / 2) }));
    const pool = caps.reduce((s, c) => s + c.cap, 0);
    let want = Math.max(0, Math.min(pool, Math.round(desiredTotal || 0)));
    const contributions = [];
    const cmdCap = caps.find(c => c.officerId === commander.id);
    if (cmdCap) {
        const amt = Math.min(cmdCap.cap, want);
        if (amt > 0) contributions.push({ officerId: commander.id, amount: amt });
        want -= amt;
    }
    const others = caps.filter(c => c.officerId !== commander.id && c.cap > 0);
    const othersPool = others.reduce((s, c) => s + c.cap, 0);
    if (want > 0 && othersPool > 0) {
        let given = 0;
        others.forEach((c, idx) => {
            let share = (idx === others.length - 1) ? (want - given) : Math.floor(want * c.cap / othersPool);
            share = Math.max(0, Math.min(c.cap, share));
            if (share > 0) { contributions.push({ officerId: c.officerId, amount: share }); given += share; }
        });
        let leftover = want - given;
        if (leftover > 0) {
            for (const c of others) {
                if (leftover <= 0) break;
                const entry = contributions.find(x => x.officerId === c.officerId);
                const already = entry ? entry.amount : 0;
                const add = Math.min(c.cap - already, leftover);
                if (add > 0) {
                    if (entry) entry.amount += add; else contributions.push({ officerId: c.officerId, amount: add });
                    leftover -= add;
                }
            }
        }
    }
    const total = contributions.reduce((s, c) => s + c.amount, 0);
    return { contributions, total };
}
// 残存兵を供出比率で各武将へ返還する（敗北時と、目標が味方になっていた時）
function distributeArmyRemainder(army, totalRemainder) {
if (totalRemainder <= 0 ||!army.troops) return;
const contributions = (army.contributions && army.contributions.length > 0)
? army.contributions
: [{ officerId: army.commanderId, amount: army.troops}];
// v7 review fix: contributors now serving an enemy faction receive nothing (ronin contributors still do)
const eligible = contributions.filter(c => {
const o = gameState.officers.find(x => x.id === c.officerId);
if (!o) return false;
if (o.castleId === null || o.castleId === undefined) return true;
const oc = gameState.castles.find(x => x.id === o.castleId);
return !oc || oc.factionId === army.factionId;
});
let distributed = 0;
eligible.forEach((c, idx) => {
const officer = gameState.officers.find(o => o.id === c.officerId);
let share;
if (idx === eligible.length - 1) share = totalRemainder - distributed;
else share = Math.floor(totalRemainder * (c.amount / army.troops));
officer.troops = (officer.troops || 0) + Math.max(0, share);
distributed += Math.max(0, share);
});
}

// v8: 反乱システムの作り替え。忠誠が閾値(50)を下回った配下は毎日確率で決起する。
// 確率は忠誠が低いほど上がり、忠義特性は半減。人間が筆頭の場合は本人の意思確認を挟む。
function rebellionChanceFor(officer) {
    const loy = officer.loyalty;
    if (loy >= REBELLION_LOYALTY_THRESHOLD) return 0;
    if (officer.rebellionWarnedDay === gameState.day) return 0; // v8 review fix: 前兆が出た当日は判定しない（懐柔の猶予1日）
    if (typeof officer.rebellionCooldownUntil === 'number' && gameState.day < officer.rebellionCooldownUntil) return 0;
    let chance;
    if (loy >= 40) chance = 0.01;
    else if (loy >= 30) chance = 0.03;
    else if (loy >= 20) chance = 0.06;
    else if (loy >= 10) chance = 0.08;
    else chance = 0.10;
    if (officer.trait === 'loyal') chance *= 0.5;
    return chance;
}

// 前兆管理: 閾値を下回った配下を城主へ知らせる（1回の低下につき1回、回復したらリセット）
function updateRebellionWarnings(castle) {
    const members = getCastleOfficers(castle.id);
    if (members.length <= 1) return;
    const lord = members[0];
    members.slice(1).forEach(m => {
        if (m.loyalty < REBELLION_LOYALTY_THRESHOLD) {
            if (!m.rebellionWarned) {
                m.rebellionWarned = true;
                m.rebellionWarnedDay = gameState.day;
                addLog(`${castle.name}の ${m.name} の不満が高まっています（忠誠:${m.loyalty}）。放置すると反乱の恐れがあります。`, 'danger');
                if (isHuman(lord)) {
                    showEventNotice('反乱の兆し', `${castle.name}の配下 ${m.name} の忠誠が${m.loyalty}まで低下しています。資金配布などで懐柔しないと、反乱を起こす恐れがあります。`, 'warn', { big: true });
                }
            }
        } else if (m.rebellionWarned) {
            m.rebellionWarned = false;
        }
    });
}

// 毎日の反乱判定（advanceOneDay の日次処理から呼ばれる）
function processDailyRebellions() {
    // 人間の決起判断が10日放置されたら自動で思いとどまる扱い
    if (gameState.pendingRebellion) {
        const p = gameState.pendingRebellion;
        if (gameState.day > p.day + 10) {
            const leader = gameState.officers.find(o => o.id === p.leaderId);
            if (leader) leader.rebellionCooldownUntil = gameState.day + 30;
            addLog(`決起の機を逸し、不満分子は静まったようだ。`, 'info');
            gameState.pendingRebellion = null;
        } else {
            return; // 判断待ちの間は新たな反乱判定をしない
        }
    }
    // v8 review fix: まず全城の前兆を出し、そのあと判定する（人間の保留が発生しても他城の前兆が漏れない）
    for (const castle of gameState.castles) {
        if (getCastleOfficers(castle.id).length > 1) updateRebellionWarnings(castle);
    }
    for (const castle of gameState.castles) {
        const members = getCastleOfficers(castle.id);
        if (members.length <= 1) continue;
        const candidates = members.slice(1).filter(m => !m.isMoving && rebellionChanceFor(m) > 0);
        for (const m of candidates) {
            if (Math.random() < rebellionChanceFor(m)) {
                if (isHuman(m)) {
                    // 判断が出るまで世界を止める（advanceOneDay 側のガードと連動）。リモートの場合はAFK期限つき
                    gameState.pendingRebellion = { castleId: castle.id, leaderId: m.id, day: gameState.day, deadline: Date.now() + NET_AFK_LIMIT_MS };
                    addLog(`${castle.name}で ${m.name} の不満が限界に達し、決起の機が熟している…`, 'danger');
                    haltAutoPlay();
                    saveGame();
                    netSync();
                    promptRebellionDecision();
                    return;
                }
                executeRebellion(castle, m);
                break; // 1城につき1日1回まで
            }
        }
    }
}

// 人間の決起判断モーダル（ホスト本人の場合はその場で、ゲストの場合はスナップショット経由で表示）
let rebellionPromptKey = null;
function promptRebellionDecision() {
    const p = gameState.pendingRebellion;
    if (!p) return;
    const key = p.leaderId + '@' + p.day;
    if (rebellionPromptKey === key) return;
    const leader = gameState.officers.find(o => o.id === p.leaderId);
    const castle = gameState.castles.find(c => c.id === p.castleId);
    if (!leader || !castle) { gameState.pendingRebellion = null; return; }
    const mine = (gameState.netMode === 'guest') ? (leader.id === netMyOfficerId) : isHuman(leader) && leader.control !== 'remote';
    if (!mine) return;
    rebellionPromptKey = key;
    haltAutoPlay();
    showModal(
        '決起の時',
        `<p>${castle.name}の配下たちの不満は限界に達しています。${leader.name}が兵を挙げれば、城主を追放してこの城を奪えます。</p><p class="text-rose-400">決起しますか？（成功は確実ですが、新勢力として独立し、元の城主は浪人となります）</p>`,
        [
            { text: '決起する', class: 'bg-rose-600 text-white font-bold', onClick: () => { actionRebellionDecision(true); } },
            { text: '思いとどまる', class: 'bg-slate-700 text-slate-200', onClick: () => { actionRebellionDecision(false); } }
        ]
    );
}

function actionRebellionDecision(accept) {
    if (gameState.netMode === 'guest') {
        if (netHostConn && netHostConn.open) netHostConn.send({ type: 'rebellion-decision', accept: !!accept });
        gameState.pendingRebellion = null;
        // rebellionPromptKey は残す（古いスナップショットで同じモーダルが開き直すのを防ぐ）
        closeModal();
        return;
    }
    applyRebellionDecision(accept);
}

function applyRebellionDecision(accept) {
    const p = gameState.pendingRebellion;
    if (!p) return;
    gameState.pendingRebellion = null;
    rebellionPromptKey = null;
    const leader = gameState.officers.find(o => o.id === p.leaderId);
    const castle = gameState.castles.find(c => c.id === p.castleId);
    closeModal();
    if (!leader || !castle) { updateUI(); drawMap(); saveGame(); netSync(); return; }
    if (accept) {
        const members = getCastleOfficers(castle.id);
        if (leader.castleId === castle.id && members[0] && members[0].id !== leader.id && !leader.isMoving && leader.loyalty < REBELLION_LOYALTY_THRESHOLD) {
            executeRebellion(castle, leader);
        } else {
            addLog(`${leader.name} の決起は、状況が変わったため立ち消えになりました。`, 'info');
        }
    } else {
        leader.rebellionCooldownUntil = gameState.day + 30;
        addLog(`${leader.name} は決起を思いとどまった。`, 'info');
    }
    updateUI();
    drawMap();
    saveGame();
    netSync();
}

// 反乱の実行（旧 checkCastleRebellion の解決処理を分離し、筆頭を指定できるようにした）
function executeRebellion(castle, leader) {
const members = getCastleOfficers(castle.id);
if (members.length <= 1) return;
const lord = members[0];
if (!lord || lord.id === leader.id) return;
if (leader.isMoving || leader.loyalty >= REBELLION_LOYALTY_THRESHOLD) return; // v8 review fix: 実行時点でも条件を確認する
const rebels = members.slice(1).filter(m => m.loyalty < REBELLION_LOYALTY_THRESHOLD);
const newFactionId = createRebelFaction(leader.name);

addLog(`${castle.name}にて不満を抱いた ${leader.name} が決起！城主 ${lord.name} を追放しました！`, 'danger');
addChronicle(`${leader.name} が ${castle.name} で決起し、城主 ${lord.name} を追放`, 'rebellion');
const lordIsLocalHuman = isHuman(lord) && lord.control !== 'remote'; // v8 review fix: リモート城主の追放モーダルをホスト画面に出さない
if (lordIsLocalHuman) { haltAutoPlay(); }
else if (members.some(m => isHuman(m))) { showEventNotice('反乱発生', `${castle.name}で${leader.name}が決起し、城主${lord.name}が追放されました。`, 'danger', { big: true }); }
else { showEventNotice('反乱発生', `${castle.name}で${leader.name}が決起しました。`, 'warn', {}); }

 const oldLordMerit = lord.merit;
 lord.castleId = null;
 lord.merit = Math.floor(lord.merit * 0.5);
lord.nextStrategyDay = null;

if (lordIsLocalHuman) {
showModal(
'反乱による城主追放',
`<p>共有資金の管理失敗や工作により、配下の <strong>${leader.name}</strong> が反乱を起こしました！</p>
<p class="text-rose-400">${lord.name}は城を追放され、浪人の身へと転落しました（功績ポイント半減）。</p>
<p class="text-xs text-slate-400 mt-2">※蓄積した個人資産（${lord.gold}G）と私兵（${lord.troops || 0}兵）は手元に残ります。浪人として再起するか、最初からやり直すか選べます。</p>`,
[
{ text: '浪人として再起する', class: 'bg-amber-600 text-slate-950 font-bold', onClick: closeModal},
{ text: '最初からやり直す', class: 'bg-slate-700 text-slate-200', onClick: resetGame}
]
);
}

castle.factionId = newFactionId;
setTerritory(castle.q, castle.r, newFactionId); // v7: 反乱でも城マスの領地が移る
 leader.merit = oldLordMerit + 50;
leader.loyalty = 100;
leader.rebellionWarned = false;
rebels.forEach(r => { if (r.id !== leader.id) { r.loyalty = 85; r.rebellionWarned = false; } });
syncCastleLords();
}

function processFieldBattles() {
    const fought = new Set();
    const attacks = gameState.armies.filter(a => a.type === 'ATTACK');
    for (let i = 0; i < attacks.length; i++) {
        for (let j = i + 1; j < attacks.length; j++) {
            const A = attacks[i], B = attacks[j];
            if (A.factionId === B.factionId) continue;
            if (fought.has(A.id) || fought.has(B.id)) continue;
            if (A.order === 'RETURN' || B.order === 'RETURN') continue; // v7 review fix: returning armies do not fight
            if (A._foughtDay === gameState.day || B._foughtDay === gameState.day) continue; // v7 review fix: one field battle per army per day
            if (!gameState.armies.includes(A) || !gameState.armies.includes(B)) continue;
            if (typeof A.posQ !== 'number' || typeof B.posQ !== 'number') continue;
            // v7: マス単位の会敵（同じマスか隣接マスで野戦）
            if (calcDistance(A.posQ, A.posR, B.posQ, B.posR) <= 1) {
                resolveFieldBattle(A, B);
                fought.add(A.id);
                fought.add(B.id);
            }
        }
    }
}

function resolveFieldBattle(armyA, armyB) {
    const cmdA = gameState.officers.find(o => o.id === armyA.commanderId);
    const cmdB = gameState.officers.find(o => o.id === armyB.commanderId);
    const posA = armyFieldPos(armyA);
    const battleCell = posA ? (gameState.mapGrid[posA.r] && gameState.mapGrid[posA.r][posA.q]) : null;
    const battleTerrain = battleCell ? battleCell.terrain : TERRAIN.PLAIN;
    const powerOf = (army, cmd, enemyCmd) => {
        let p = army.troops * (1 + (cmd ? cmd.valor : 60) / 100) * (0.9 + Math.random() * 0.25);
        if (cmd && cmd.trait === 'brave') p *= 1.15;
        if (cmd) p *= troopTypeModifier(cmd, battleTerrain, 'field'); // v8: 兵科と地形の相性
        if (cmd) p *= troopMatchupModifier(cmd, enemyCmd); // v9: 兵科の三すくみ
        p *= stanceOf(army).dealt; // v9: 部隊方針（与える損害）
        return p;
    };
    const pA = powerOf(armyA, cmdA, cmdB), pB = powerOf(armyB, cmdB, cmdA);
    const aWins = pA >= pB;
    const winner = aWins ? armyA : armyB, loser = aWins ? armyB : armyA;
    const wCmd = aWins ? cmdA : cmdB, lCmd = aWins ? cmdB : cmdA;
    const wPow = aWins ? pA : pB, lPow = aWins ? pB : pA;

    const survivors = Math.floor(loser.troops * 0.35 * (2 - stanceOf(loser).taken)); // v9: 方針で敗残兵の戻りが変わる
    distributeArmyRemainder(loser, survivors);
    if (lCmd) {
        lCmd.isMoving = false;
        const lOrigin = gameState.castles.find(c => c.id === loser.originCastleId);
        lCmd.castleId = (lOrigin && lOrigin.factionId === loser.factionId) ? loser.originCastleId : null;
        if (lCmd.castleId === null) addLog(`${lCmd.name}の帰還先 ${lOrigin ? lOrigin.name : '城'} は既に陥落しており、浪人となりました。`, 'warn');
        lCmd.merit += meritGainFor(lCmd, 20);
    }
    const li = gameState.armies.indexOf(loser);
    if (li >= 0) gameState.armies.splice(li, 1);

    const rawRemain = Math.floor(winner.troops * (1 - (lPow / (wPow * 1.4)) * stanceOf(winner).dealt * stanceOf(winner).taken)); // v9 review fix: 勝者の損害は dealt と taken の積で効かせる（相殺防止）
    winner.troops = isFinite(rawRemain) ? Math.max(150, rawRemain) : 150;
    winner._foughtDay = gameState.day; // v7 review fix: one field battle per army per day
    if (wCmd) { wCmd.merit += meritGainFor(wCmd, 60); gainOfficerExp(wCmd, 'valor', 40); gainOfficerExp(wCmd, 'leadership', 20); bumpOfficerStat(wCmd, 'battlesWon'); } // v8: 勝者は成長し戦績が残る
    if (loser.troops >= 1200) addChronicle(`${wCmd ? wCmd.name : '部隊'}隊 が野戦で ${lCmd ? lCmd.name : '敵'}隊（${loser.troops}兵）を破る`, 'field');

    addLog(`${wCmd ? wCmd.name : '部隊'}隊（${FACTIONS[winner.factionId]?.name || '不明'}）が野戦で ${lCmd ? lCmd.name : '敵'}隊（${FACTIONS[loser.factionId]?.name || '不明'}）を破りました！敗れた部隊は壊滅し、勝者は${winner.troops}兵で進軍を継続します。`, 'warn');
    if (wCmd && isHuman(wCmd)) {
        showEventNotice('野戦で勝利', `${wCmd.name}隊が野戦で${lCmd ? lCmd.name : '敵'}隊を破りました！残り${winner.troops}兵で進軍を継続します。`, 'good', {});
    }
    if (lCmd && isHuman(lCmd)) {
        showEventNotice('野戦で敗北', `${lCmd.name}隊が野戦で${wCmd ? wCmd.name : '敵'}隊に敗れ、壊滅しました。`, 'danger', {});
    }
}

function resolveSiegeBattle(army, targetCastle, commander) {
if (!targetCastle) return;

if (targetCastle.factionId === army.factionId) {
distributeArmyRemainder(army, army.troops);
if (commander) commander.castleId = targetCastle.id;
syncCastleLords();
return;
}

const defenders = getCastleOfficers(targetCastle.id);
const defLord = defenders[0];
const defTroops = getCastleTroops(targetCastle.id);

// v6: 籠城戦による内政の荒廃（守備側がいる場合のみ、勝敗問わず、下限ECONOMY_MIN）

const atkValor = commander? commander.valor: 60;
const defValor = defLord? defLord.valor: 55;

let atkPower = army.troops * (1 + atkValor / 100) * (0.9 + Math.random() * 0.25);
if (commander && commander.trait === 'brave') atkPower *= 1.15;
if (commander) atkPower *= troopTypeModifier(commander, null, 'siege-attack'); // v8: 歩兵の攻城 +10%
atkPower *= stanceOf(army).dealt; // v9: 部隊方針（与える損害）
if (typeof getSeason === 'function' && getSeason(gameState.day).id === 'winter') atkPower *= 0.9; // v9: 冬の攻城は1割不利
let defPower = (defTroops + 100) * (1 + defValor / 100) * (0.95 + Math.random() * 0.2) * getSiegeBuff(targetCastle) * castleDefenseFactor(targetCastle); // v9: 要塞補正
if (defLord && defLord.trait === 'ironwall') defPower *= 1.15;
if (defLord) defPower *= troopTypeModifier(defLord, null, 'siege-defense'); // v8: 歩兵の守備 +10%

const factionName = FACTIONS[army.factionId]?.name || '攻撃軍';
const playerInvolved = (commander && isHuman(commander)) || defenders.some(d => isHuman(d));

if (atkPower > defPower) {
const remainingTroops = Math.max(150, Math.floor(army.troops * (1 - (defPower / (atkPower * 1.4)) * stanceOf(army).dealt * stanceOf(army).taken))); // v9 review fix: 攻城の損害も dealt と taken の積で効かせる
targetCastle.factionId = army.factionId;
setTerritory(targetCastle.q, targetCastle.r, army.factionId); // v7: 落城した城マスも領地が移る

// 防御側の私兵は比率で損害を受け、生き残りは城を追われて浪人になる
defenders.forEach(d => {
d.troops = Math.max(80, Math.floor((d.troops || 0) * 0.55));
d.castleId = null;
// v7: 戦闘で負けて浪人になっても功績は半減しない（仕様変更。下野と反乱の半減は従来どおり）
d.nextStrategyDay = null;
if (isHuman(d)) {
addLog(`${d.name}が守備していた ${targetCastle.name} が陥落！浪人となりました。`, 'danger');
showEventNotice('城が陥落', `${d.name}が守っていた${targetCastle.name}が${factionName}に落ち、浪人となりました。`, 'danger', { big: true, halt: true });
}
});

if (commander) {
// 勝利した出撃兵の残存は、指揮官の私兵として攻略城に駐留する
commander.troops = (commander.troops || 0) + remainingTroops;
gainOfficerExp(commander, 'valor', 30); // v8/v9 review fix: 成長は所属城が攻略先に移る前に付ける（武門判定を出撃元で効かせる）
gainOfficerExp(commander, 'leadership', 30);
commander.castleId = targetCastle.id;
const meritGain = meritGainFor(commander, 120 + Math.floor(defValor * 0.5));
commander.merit += meritGain;
bumpOfficerStat(commander, 'castlesTaken');
addChronicle(`${commander.name}（${factionName}）が ${targetCastle.name} を攻略`, 'siege');
if (isHuman(commander)) {
addLog(`${commander.name}が${targetCastle.name}を攻略！功績 +${meritGain}pt を獲得しました！`, 'good');
showEventNotice('落城！', `${commander.name}が${targetCastle.name}を攻略しました！`, 'good', { big: true });
}
}

addLog(`${factionName}の ${commander?.name || '部隊'} が ${targetCastle.name} を占領しました！`, 'warn');
if (!playerInvolved) showEventNotice('城が落ちた', `${factionName}が${targetCastle.name}を占領しました。`, 'warn', {});
syncCastleLords();
} else {
if (defLord) { gainOfficerExp(defLord, 'valor', 30); bumpOfficerStat(defLord, 'battlesWon'); } // v8: 籠城成功で城主が成長し戦績が残る
// 防御側の私兵へ比率でダメージ
if (defTroops > 0) {
const remainingDef = Math.max(200, Math.floor(defTroops * (1 - atkPower / (defPower * 1.6))));
const factor = remainingDef / defTroops;
defenders.forEach(d => {
d.troops = Math.max(80, Math.floor((d.troops || 0) * factor));
});
}

// 攻撃側の残存兵（35パーセント）は供出者へ比率で返還される
const survivors = Math.floor(army.troops * 0.35 * (2 - stanceOf(army).taken)); // v9: 方針で敗残兵の戻りが変わる
distributeArmyRemainder(army, survivors);

if (commander) {
const originCastle = gameState.castles.find(c => c.id === army.originCastleId);
commander.castleId = (originCastle && originCastle.factionId === army.factionId) ? army.originCastleId : null;
if (commander.castleId === null) addLog(`${commander.name}の帰還先 ${originCastle ? originCastle.name : '城'} は既に陥落しており、浪人となりました。`, 'warn');
commander.merit += meritGainFor(commander, 20);
if (isHuman(commander)) {
addLog(`${commander.name}が${targetCastle.name}の攻略に失敗し、元の城へ撤退しました。`, 'danger');
showEventNotice('攻略失敗', `${commander.name}は${targetCastle.name}の守備隊に退けられました。`, 'warn', {});
}
}
if (defLord) {
const defMerit = meritGainFor(defLord, 60);
defLord.merit += defMerit;
if (isHuman(defLord)) {
addLog(`${defLord.name}が${targetCastle.name}への敵襲を撃退！功績 +${defMerit}pt を獲得！`, 'good');
showEventNotice('敵襲を撃退', `${defLord.name}が守る${targetCastle.name}への侵攻を退けました。`, 'good', {});
}
}
const playerDefender = defenders.find(d => isHuman(d));
if (playerDefender && (!defLord || !isHuman(defLord))) {
showEventNotice('敵襲を撃退', `${playerDefender.name}が守る${targetCastle.name}への侵攻を退けました。`, 'good', {});
}
addLog(`${targetCastle.name}の守備隊が ${factionName} の侵攻を退けました。`, 'info');
}

// v6: 内政の荒廃は戦闘解決後に適用する（今回の戦闘の籠城バフは戦闘前の内政で計算済み）
if (defTroops > 0 && targetCastle.economy > ECONOMY_MIN) {
const ecoBefore = targetCastle.economy;
const ecoDamage = isEncircled(targetCastle) ? 30 : SIEGE_ECONOMY_DAMAGE; // v7: 包囲下では荒廃が進む
targetCastle.economy = Math.max(ECONOMY_MIN, targetCastle.economy - ecoDamage);
addLog(`${targetCastle.name}は戦火により荒廃し、内政が低下しました（${ecoBefore} → ${targetCastle.economy}）。`, 'warn');
}
}