// CHRONICLE OF BETRAYAL — world.js: マップ・領地・経路計算・部隊移動


// --- ユーティリティ関数 ---

function calcDistance(q1, r1, q2, r2) {
    const x1 = q1 - (r1 - (r1 & 1)) / 2;
    const z1 = r1;
    const y1 = -x1 - z1;

    const x2 = q2 - (r2 - (r2 & 1)) / 2;
    const z2 = r2;
    const y2 = -x2 - z2;

    return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
}

// 行軍日数: 距離×4日に、指揮官の統率補正と中間マスの地形補正を加える
function calcTravelInfo(origin, target, commander) {
// v7: マス目移動ベースの予想到着日数（経路コスト合計 ÷ 1日の移動力）
const dist = calcDistance(origin.q, origin.r, target.q, target.r);
let days = Math.max(1, dist);
if (gameState.mapGrid.length > 0) {
const path = findPath(origin.q, origin.r, target.q, target.r, origin.factionId || 0);
days = Math.max(1, estimateDaysForPath(path, commander, origin.factionId || 0));
}
return { dist, days, terrainBonus: 0, terrainName: '経路', factor: 1 };
}

// --- v7 追加: マス目移動（ヘックス経路探索。座標系は odd-r オフセットで calcDistance と一致） ---
const HEX_DIRS_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const HEX_DIRS_ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];

function hexNeighbors(q, r) {
const dirs = (r % 2 === 1) ? HEX_DIRS_ODD : HEX_DIRS_EVEN;
const out = [];
for (const d of dirs) {
const nq = q + d[0], nr = r + d[1];
if (nq >= 0 && nq < MAP_COLS && nr >= 0 && nr < MAP_ROWS) out.push({ q: nq, r: nr });
}
return out;
}

function getTerritory(q, r) {
if (!gameState.territory || !gameState.territory[r]) return 0;
return gameState.territory[r][q] || 0;
}

// v8: 領地開発（0=なし, 1=農地, 2=関所）。領地グリッドと並行に持つ
function getDevelopment(q, r) {
if (!gameState.development || !gameState.development[r]) return 0;
return gameState.development[r][q] || 0;
}
function setDevelopment(q, r, v) {
if (!gameState.development || !gameState.development[r]) return;
gameState.development[r][q] = v;
}
function initDevelopment() {
gameState.development = [];
for (let r = 0; r < MAP_ROWS; r++) {
const row = [];
for (let q = 0; q < MAP_COLS; q++) row.push(0);
gameState.development.push(row);
}
}
// v8: 勢力の農地マス数（領地収入の加算に使う）
function countFarmland(factionId) {
let n = 0;
if (!gameState.territory || !gameState.development) return 0;
gameState.territory.forEach((row, r) => row.forEach((v, q) => { if (v === factionId && gameState.development[r] && gameState.development[r][q] === 1) n++; }));
return n;
}

function terrainMoveCost(terrain) {
if (!terrain) return 1;
if (terrain.id === 3) return 3; // 河川
if (terrain.id === 1 || terrain.id === 2) return 2; // 森・山岳
return 1; // 平原
}

function tileEnterCost(q, r, factionId) {
if (gameState.castles.some(c => c.q === q && c.r === r)) return 1; // 城マスは常に1
const cell = gameState.mapGrid[r] && gameState.mapGrid[r][q];
let cost = terrainMoveCost(cell ? cell.terrain : null);
if (factionId) {
const owner = getTerritory(q, r);
if (owner && owner !== factionId) {
cost += 1; // 敵地は補給が悪く重い
if (getDevelopment(q, r) === 2) cost += 2; // v8: 敵の関所があるマスはさらに重い
}
}
return cost;
}

function findPath(sq, sr, tq, tr, factionId) {
if (sq === tq && sr === tr) return [];
const key = (q, r) => r * MAP_COLS + q;
const dist = new Map();
const prev = new Map();
dist.set(key(sq, sr), 0);
const pq = [[0, sq, sr]];
while (pq.length > 0) {
let bi = 0;
for (let i = 1; i < pq.length; i++) if (pq[i][0] < pq[bi][0]) bi = i;
const cur = pq.splice(bi, 1)[0];
const d = cur[0], q = cur[1], r = cur[2];
if (d > (dist.has(key(q, r)) ? dist.get(key(q, r)) : Infinity)) continue;
if (q === tq && r === tr) break;
for (const n of hexNeighbors(q, r)) {
// v7 review fix: castle tiles other than start/target are impassable (no routing through enemy castles)
if (!(n.q === tq && n.r === tr) && gameState.castles.some(c => c.q === n.q && c.r === n.r)) continue;
let stepCost = tileEnterCost(n.q, n.r, factionId);
// v9 stage F: 敵支砦のマスは経路コストを重くして迂回を促す（目標マスそのものは除く。踏めば支砦戦になる）
if (!(n.q === tq && n.r === tr) && factionId) { const ef = fortAt(n.q, n.r); if (ef && ef.factionId !== factionId) stepCost += 4; }
const nd = d + stepCost;
const k = key(n.q, n.r);
if (nd < (dist.has(k) ? dist.get(k) : Infinity)) {
dist.set(k, nd);
prev.set(k, { q: q, r: r });
pq.push([nd, n.q, n.r]);
}
}
}
if (!prev.has(key(tq, tr))) return [];
const path = [];
let cur = { q: tq, r: tr };
while (!(cur.q === sq && cur.r === sr)) {
path.unshift(cur);
cur = prev.get(key(cur.q, cur.r));
if (!cur) return [];
}
return path;
}

function pathTotalCost(path, factionId) {
return (path || []).reduce((s, t) => s + tileEnterCost(t.q, t.r, factionId), 0);
}

// v9: 季節（1年=360日、3か月ごとに春夏秋冬）
const SEASONS = [
    { id: 'spring', name: '春' }, { id: 'summer', name: '夏' },
    { id: 'autumn', name: '秋' }, { id: 'winter', name: '冬' }
];
function getSeason(day) {
    const d = Math.max(1, Math.floor(day) || 1); // v9 review fix: 0以下や非数でも落ちないようにする
    const month = Math.floor(((d - 1) % 360) / 30) + 1;
    return SEASONS[Math.floor((month - 1) / 3)];
}

// v7: 1日の移動力（統率で2〜4、神速で1.5倍）
function calcMovePoints(commander) {
let base = 2;
if (commander) {
if (commander.leadership >= 85) base = 4;
else if (commander.leadership >= 65) base = 3;
if (commander.trait === 'swift') base = Math.round(base * 1.5); // v7 review fix: was floor, which made swift useless in the leadership 65-84 band
}
if (getSeason(gameState.day).id === 'winter') base -= 1; // v9: 冬は移動力-1
return Math.max(1, base);
}

// v8 review fix: 強行軍中の部隊は移動力ボーナスを得る（到着予測にも反映する）
function armyMoveBonus(army) {
return (army && army.forcedUntil && gameState.day <= army.forcedUntil) ? 2 : 0;
}

function estimateDaysForPath(path, commander, factionId, forcedUntilDay) {
// v7 review fix: replay the real movement rules (daily points, no carry-over, min 1 tile) so estimates match actual travel
// v9 review fix: 強行軍の+2は forcedUntilDay までの日だけ適用する（全行程に効く前提にしない）
if (!path || path.length === 0) return 0;
const basePoints = calcMovePoints(commander);
const pointsFor = (dayOffset) => basePoints + ((forcedUntilDay && gameState.day + dayOffset <= forcedUntilDay) ? 2 : 0);
let days = 1;
let points = pointsFor(0);
let movedToday = false;
for (const t of path) {
const cost = tileEnterCost(t.q, t.r, factionId);
if (cost > points && movedToday) { days++; points = pointsFor(days - 1); movedToday = false; }
points = (cost > points) ? 0 : points - cost;
movedToday = true;
}
return days;
}

// v7: 部隊に現在マスと経路を持たせる
function initArmyRoute(army) {
const target = (army.targetCastleId !== null && army.targetCastleId !== undefined) ? gameState.castles.find(c => c.id === army.targetCastleId) : null;
const commander = gameState.officers.find(o => o.id === army.commanderId);
// v7 review fix: legacy armies without an origin fall back to the commander's castle, then the target (never (0,0))
const origin = gameState.castles.find(c => c.id === army.originCastleId)
|| (commander && commander.castleId !== null && commander.castleId !== undefined ? gameState.castles.find(c => c.id === commander.castleId) : null)
|| target;
// v9 stage F: 目標は城かマス（targetTile）のどちらか
const dest = target ? { q: target.q, r: target.r } : (army.targetTile ? { q: army.targetTile.q, r: army.targetTile.r } : null);
army.posQ = origin ? origin.q : 0;
army.posR = origin ? origin.r : 0;
if (!army.order) army.order = 'ADVANCE';
army.path = (origin && dest) ? findPath(origin.q, origin.r, dest.q, dest.r, army.factionId) : [];
const est = estimateDaysForPath(army.path, commander, army.factionId, army.forcedUntil || 0);
army.totalDays = Math.max(1, est);
army.daysLeft = army.totalDays;
}

// --- v7 追加: 陣取り（マス領地） ---
function setTerritory(q, r, factionId) {
if (!gameState.territory || !gameState.territory[r]) return;
if (gameState.territory[r][q] !== factionId) {
// v8: 領地の持ち主が変わったら開発施設は失われる
setDevelopment(q, r, 0);
gameState.territory[r][q] = factionId;
}
}

function initTerritory() {
initDevelopment();
gameState.territory = [];
for (let r = 0; r < MAP_ROWS; r++) {
const row = [];
for (let q = 0; q < MAP_COLS; q++) row.push(0);
gameState.territory.push(row);
}
recomputeTerritory();
}

// v9 stage F: そのマスにある支砦（なければ null）
function fortAt(q, r) {
if (!Array.isArray(gameState.forts)) return null;
return gameState.forts.find(f => f.q === q && f.r === r) || null;
}

// v9 stage F: 領地のアンカー再計算。各マスの色は最も近いアンカー（城=半径 CASTLE_TERRITORY_RADIUS、支砦=半径 FORT_RADIUS）の勢力。
// 届くアンカーがなければ中立。同距離なら城が優先し、それも同じなら先に登録されたアンカーが優先（決定的にするため）。
// 色が変わったマスの開発施設は失われる（v8 のルールを踏襲）。
function recomputeTerritory() {
if (!gameState.mapGrid || gameState.mapGrid.length === 0) return;
if (!Array.isArray(gameState.territory) || gameState.territory.length !== MAP_ROWS) {
gameState.territory = [];
for (let r = 0; r < MAP_ROWS; r++) { const row = []; for (let q = 0; q < MAP_COLS; q++) row.push(0); gameState.territory.push(row); }
}
const anchors = [];
gameState.castles.forEach(c => anchors.push({ q: c.q, r: c.r, factionId: c.factionId, radius: CASTLE_TERRITORY_RADIUS, isCastle: true }));
(gameState.forts || []).forEach(f => anchors.push({ q: f.q, r: f.r, factionId: f.factionId, radius: FORT_RADIUS, isCastle: false }));
for (let r = 0; r < MAP_ROWS; r++) {
if (!Array.isArray(gameState.territory[r]) || gameState.territory[r].length !== MAP_COLS) { const fixedRow = []; for (let q = 0; q < MAP_COLS; q++) fixedRow.push(0); gameState.territory[r] = fixedRow; } // Copilot指摘: 欠落行への書き込み例外を防ぐ
for (let q = 0; q < MAP_COLS; q++) {
let best = null;
for (const a of anchors) {
const d = calcDistance(q, r, a.q, a.r);
if (d > a.radius) continue;
if (!best || d < best.d || (d === best.d && a.isCastle && !best.isCastle)) best = { d, factionId: a.factionId, isCastle: a.isCastle };
}
const owner = best ? best.factionId : 0;
if (gameState.territory[r][q] !== owner) {
if (gameState.territory[r][q] !== 0) setDevelopment(q, r, 0); // 持ち主がいたマスの色が変わったら施設は失われる
gameState.territory[r][q] = owner;
}
}
}
}

function countTerritory(factionId) {
let n = 0;
if (!gameState.territory) return 0;
gameState.territory.forEach(row => row.forEach(v => { if (v === factionId) n++; }));
return n;
}

// v7: 城の周囲マスがすべて敵勢力の領地なら包囲状態
function isEncircled(castle) {
const ns = hexNeighbors(castle.q, castle.r);
if (ns.length === 0) return false;
return ns.every(n => {
const owner = getTerritory(n.q, n.r);
return owner !== 0 && owner !== castle.factionId;
});
}

// v9 stage F: 旧 processTerritoryClaims（部隊が止まったマスを領地化）は廃止。
// 領地は城と支砦のアンカーだけで決まる（recomputeTerritory）。互換のため空関数は残さない。

// v6: 野戦（会敵）。敵対する攻撃部隊同士がフィールド上で接近したら戦闘する
function armyFieldPos(army, daysLeftOverride) {
// v7: 部隊はマス単位で存在するので現在マスをそのまま返す
if (army && typeof army.posQ === 'number') return { q: army.posQ, r: army.posR };
const origin = gameState.castles.find(c => c.id === army.originCastleId);
if (!origin) return null;
return { q: origin.q, r: origin.r };
}

function axialDistance(a, b) {
    const dq = a.q - b.q, dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
function processArmiesMovement() {
    // v7 review fix: iterate over a snapshot (a field battle during movement may remove other armies)
    const snapshot = gameState.armies.slice();
    for (const army of snapshot) {
        if (!gameState.armies.includes(army)) continue;
        // v7: 経路を持たない部隊（旧形式）は現在地から引き直す
        if (typeof army.posQ !== 'number' || !Array.isArray(army.path)) initArmyRoute(army);
        const commander = gameState.officers.find(o => o.id === army.commanderId);
        const targetCastle = gameState.castles.find(c => c.id === army.targetCastleId);

        if (army.order === 'WAIT') continue; // 待機中は動かない（その場で野戦は起こる）

        let points = calcMovePoints(commander) + armyMoveBonus(army); // v8: 強行軍中は移動力+2
        let moved = false;
        let arrived = false;
        let destroyed = false;
        let foughtToday = false;
        while (points > 0 && army.path.length > 0) {
            const next = army.path[0];
            const cost = tileEnterCost(next.q, next.r, army.factionId);
            if (cost > points && moved) break;
            // その日まだ動いていない場合は、コスト超過でも1マスは進む（最低保証）
            points = (cost > points) ? 0 : points - cost;
            army.posQ = next.q;
            army.posR = next.r;
            army.path.shift();
            moved = true;
            // v9 stage F: 敵支砦のマスに入ったら、その場で支砦戦（帰還中の部隊は戦わない）。勝敗どちらの場合もその日の行軍はここまで
            if (army.type === 'ATTACK' && army.order !== 'RETURN') {
                const fortHere = fortAt(army.posQ, army.posR);
                if (fortHere && fortHere.factionId !== army.factionId) {
                    resolveFortBattle(army, fortHere);
                    foughtToday = true;
                    if (!gameState.armies.includes(army)) { destroyed = true; }
                    break;
                }
            }
            // v7 review fix: 移動の途中で敵部隊と近接したら、その場で野戦（城前の迎撃や行き違いの会敵が成立する）
            if (army.type === 'ATTACK' && army.order !== 'RETURN' && army._foughtDay !== gameState.day) {
                const foe = gameState.armies.find(a => a !== army && a.type === 'ATTACK' && a.order !== 'RETURN' && a.factionId !== army.factionId && a._foughtDay !== gameState.day && typeof a.posQ === 'number' && calcDistance(army.posQ, army.posR, a.posQ, a.posR) <= 1);
                if (foe) {
                    resolveFieldBattle(army, foe);
                    foughtToday = true;
                    if (!gameState.armies.includes(army)) { destroyed = true; break; }
                    break; // 勝ってもその日は行軍停止（隊列の立て直し）
                }
            }
            if (targetCastle && next.q === targetCastle.q && next.r === targetCastle.r) { arrived = true; break; }
        }
        if (destroyed) continue;
        if (!arrived && !foughtToday && targetCastle && army.posQ === targetCastle.q && army.posR === targetCastle.r) arrived = true;

        army.daysLeft = army.path.length === 0 ? 0 : estimateDaysForPath(army.path, commander, army.factionId, army.forcedUntil || 0);

        if (arrived) {
            arriveArmy(army);
            const ai = gameState.armies.indexOf(army);
            if (ai >= 0) gameState.armies.splice(ai, 1);
        } else if (army.type === 'ATTACK' && !army.targetCastleId && army.targetTile && army.path.length === 0 && army.posQ === army.targetTile.q && army.posR === army.targetTile.r && army.order !== 'WAIT') {
            // v9 stage F: マス目標に到着したら、そのマスで待機して前線の足場にする（部隊は残る）
            arriveTileArmy(army);
        }
    }
}

// v7: 部隊の到着処理（目標マスに着いた時点で解決する）
function arriveArmy(army) {
    const targetCastle = gameState.castles.find(c => c.id === army.targetCastleId);
    const commander = gameState.officers.find(o => o.id === army.commanderId);
    if (commander) commander.isMoving = false;

    if (army.order === 'RETURN') {
        distributeArmyRemainder(army, army.troops);
        if (commander) {
            const originCastle = gameState.castles.find(c => c.id === army.originCastleId);
            commander.castleId = (originCastle && originCastle.factionId === army.factionId) ? originCastle.id : null;
            if (commander.castleId === null) addLog(`${commander.name}の帰還先 ${originCastle ? originCastle.name : '城'} は既に陥落しており、浪人となりました。`, 'warn');
            else if (isHuman(commander)) addLog(`${commander.name} 隊が ${originCastle.name} へ帰還しました。`, 'good');
        }
        syncCastleLords();
        return;
    }

    if (army.type === 'RELOCATE') {
        if (targetCastle && targetCastle.factionId === army.factionId && commander) {
            commander.castleId = targetCastle.id;
            if (isHuman(commander)) {
                addLog(`${commander.name}が${targetCastle.name}へ到着し、配属が完了しました。`, 'good');
            }
            syncCastleLords();
        } else if (commander) {
            commander.castleId = null;
            if (isHuman(commander)) {
                addLog(`${commander.name}の目的地 ${targetCastle ? targetCastle.name : '城'} はすでに敵手に落ちており、浪人となりました。`, 'warn');
            }
        }
    } else if (army.type === 'ATTACK') {
        resolveSiegeBattle(army, targetCastle, commander);
    }
}

// v9 stage F: マス目標への到着（部隊は消えず、そのマスで待機に入る）
function arriveTileArmy(army) {
    const commander = gameState.officers.find(o => o.id === army.commanderId);
    army.order = 'WAIT';
    army.daysLeft = 0;
    addLog(`${commander ? commander.name : '部隊'} 隊が目標のマス (${army.posQ}, ${army.posR}) に到着し、布陣しました。`, 'info');
    if (commander && isHuman(commander)) {
        showEventNotice('マスに到着', `${commander.name} 隊が (${army.posQ}, ${army.posR}) に到着し、待機に入りました。`, 'good', {});
    }
}