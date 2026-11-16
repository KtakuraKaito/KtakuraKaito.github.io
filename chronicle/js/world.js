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
const nd = d + tileEnterCost(n.q, n.r, factionId);
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

// v7: 1日の移動力（統率で2〜4、神速で1.5倍）
function calcMovePoints(commander) {
let base = 2;
if (commander) {
if (commander.leadership >= 85) base = 4;
else if (commander.leadership >= 65) base = 3;
if (commander.trait === 'swift') base = Math.round(base * 1.5); // v7 review fix: was floor, which made swift useless in the leadership 65-84 band
}
return Math.max(1, base);
}

// v8 review fix: 強行軍中の部隊は移動力ボーナスを得る（到着予測にも反映する）
function armyMoveBonus(army) {
return (army && army.forcedUntil && gameState.day <= army.forcedUntil) ? 2 : 0;
}

function estimateDaysForPath(path, commander, factionId, bonusPoints) {
// v7 review fix: replay the real movement rules (daily points, no carry-over, min 1 tile) so estimates match actual travel
if (!path || path.length === 0) return 0;
const pointsPerDay = calcMovePoints(commander) + (bonusPoints || 0);
let days = 1;
let points = pointsPerDay;
let movedToday = false;
for (const t of path) {
const cost = tileEnterCost(t.q, t.r, factionId);
if (cost > points && movedToday) { days++; points = pointsPerDay; movedToday = false; }
points = (cost > points) ? 0 : points - cost;
movedToday = true;
}
return days;
}

// v7: 部隊に現在マスと経路を持たせる
function initArmyRoute(army) {
const target = gameState.castles.find(c => c.id === army.targetCastleId);
const commander = gameState.officers.find(o => o.id === army.commanderId);
// v7 review fix: legacy armies without an origin fall back to the commander's castle, then the target (never (0,0))
const origin = gameState.castles.find(c => c.id === army.originCastleId)
|| (commander && commander.castleId !== null && commander.castleId !== undefined ? gameState.castles.find(c => c.id === commander.castleId) : null)
|| target;
army.posQ = origin ? origin.q : 0;
army.posR = origin ? origin.r : 0;
if (!army.order) army.order = 'ADVANCE';
army.path = (origin && target) ? findPath(origin.q, origin.r, target.q, target.r, army.factionId) : [];
const est = estimateDaysForPath(army.path, commander, army.factionId, armyMoveBonus(army));
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
// v7 review fix: castle tiles first, then rings claim only unclaimed tiles (processing order must not steal a neighbour castle's ring)
gameState.castles.forEach(castle => setTerritory(castle.q, castle.r, castle.factionId));
gameState.castles.forEach(castle => {
hexNeighbors(castle.q, castle.r).forEach(n => { if (getTerritory(n.q, n.r) === 0) setTerritory(n.q, n.r, castle.factionId); });
});
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

// v7: 1日の終わりに部隊が止まっているマスをその勢力の領地にする（兵力300以上、城マスは除く）
function processTerritoryClaims() {
gameState.armies.forEach(army => {
if (army.type !== 'ATTACK') return;
if (army.order === 'RETURN') return; // v7 review fix: returning armies do not claim territory
if ((army.troops || 0) < 300) return;
if (typeof army.posQ !== 'number') return;
if (gameState.castles.some(c => c.q === army.posQ && c.r === army.posR)) return;
setTerritory(army.posQ, army.posR, army.factionId);
});
}

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

        army.daysLeft = army.path.length === 0 ? 0 : estimateDaysForPath(army.path, commander, army.factionId, armyMoveBonus(army));

        if (arrived) {
            arriveArmy(army);
            const ai = gameState.armies.indexOf(army);
            if (ai >= 0) gameState.armies.splice(ai, 1);
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