// CHRONICLE OF BETRAYAL — state.js: ゲーム状態・初期化・セーブ/ロード・武将と城の参照
 // v2: セーブデータのキー
let nextFactionId = 6;

// --- ゲーム状態管理 ---
let gameState = {
    day: 1,
    autoPlay: false,
    autoTimer: null, autoHalted: false,
    activePhase: null, // null | 'PERSONAL' | 'STRATEGY'
    selectedCastleId: 1, selectedTile: null, mapSize: 'standard', chronicle: [],
    unifiedAchieved: false,
    endlessMode: false,
    mapGrid: [],
    territory: [],
    castles: [],
    officers: [],
    armies: [],
    playerId: 'player', humans: [], activeOfficerId: null, viewOfficerId: null, pendingPhase: null, pendingRebellion: null, setupDone: false, _statusByOfficer: {}, netMode: 'local', netCode: null, logLines: []
};

function calcActionInterval(officer) {
    const avg = (officer.valor + officer.leadership + officer.intellect) / 3;
    if (avg >= 85) return 6;
    if (avg >= 78) return 7;
    if (avg >= 70) return 8;
    if (avg >= 60) return 9;
    return 10;
}

function calcSalary(merit) {
    const baseSalary = 20;
    return baseSalary + Math.floor(Math.sqrt(Math.max(0, merit)) * 4.5);
}
function traitName(id) { return id && TRAITS[id] ? TRAITS[id].name : ''; }
function meritGainFor(officer, base) { return officer && officer.trait === 'fame' ? Math.round(base * 1.25) : base; }
function loyaltyLossFor(officer, base) { return officer && officer.trait === 'loyal' ? Math.round(base * 0.5) : base; }

// v8: 兵科の初期値（最も高い能力に合わせる。作成時に固定し、以後は変更行動でのみ変わる）
function defaultTroopType(officer) {
    if (officer.intellect >= officer.valor && officer.intellect >= officer.leadership) return 'archer';
    if (officer.valor >= officer.leadership) return 'cavalry';
    return 'infantry';
}
function getTroopType(officer) {
    if (!officer) return 'infantry';
    return officer.troopType || defaultTroopType(officer);
}

// v8: 戦績クロニクル（大きな出来事を日付つきで記録する）
function addChronicle(text, kind) {
    if (!Array.isArray(gameState.chronicle)) gameState.chronicle = [];
    gameState.chronicle.push({ day: gameState.day, text, kind: kind || 'info' });
    if (gameState.chronicle.length > 300) gameState.chronicle.splice(0, gameState.chronicle.length - 300);
}
function bumpOfficerStat(officer, key) {
    if (!officer) return;
    if (!officer.stats) officer.stats = { castlesTaken: 0, battlesWon: 0 };
    officer.stats[key] = (officer.stats[key] || 0) + 1;
}

// v8: 武将の成長。経験が100たまるごとに能力+1（各能力+10まで）
function gainOfficerExp(officer, kind, amount) {
    if (!officer || amount <= 0) return;
    // v9: 武門の城に駐留する武将は武勇経験+50%
    if (kind === 'valor' && officer.castleId !== null && officer.castleId !== undefined) {
        const home = gameState.castles.find(c => c.id === officer.castleId);
        if (home && home.specialty === 'martial') amount = Math.round(amount * 1.5);
    }
    if (!officer.xp) officer.xp = { valor: 0, leadership: 0, intellect: 0 };
    if (!officer.growth) officer.growth = { valor: 0, leadership: 0, intellect: 0 };
    officer.xp[kind] = (officer.xp[kind] || 0) + amount;
    while ((officer.growth[kind] || 0) < 10 && officer.xp[kind] >= ((officer.growth[kind] || 0) + 1) * 100) {
        officer.growth[kind] = (officer.growth[kind] || 0) + 1;
        officer[kind] = (officer[kind] || 0) + 1;
        const label = kind === 'valor' ? '武勇' : (kind === 'leadership' ? '統率' : '知力');
        addLog(`${officer.name} の ${label} が成長しました（現在 ${officer[kind]}）。`, 'good');
        if (isHuman(officer)) showEventNotice('能力が成長', `${officer.name} の ${label} が ${officer[kind]} に上がりました。`, 'good', {});
    }
}
function isHuman(o) { return !!(o && o.humanId); }
function humanOf(o) { return gameState.humans.find(h => h.officerId === (o && o.id)) || null; }



// --- v2 追加: 個人兵力・移動・勢力・セーブのヘルパー ---

// 城の兵力は固定プールではなく、駐留武将（移動中でない）の私兵合計で算出する（仕様4.1）
function getCastleTroops(castleId) {
return gameState.officers
.filter(o => o.castleId === castleId &&!o.isMoving)
.reduce((sum, o) => sum + (o.troops || 0), 0);
}

// 反乱などのたびに新しい勢力IDを発行する（固定IDの使い回しを廃止）
function createRebelFaction(leaderName) {
const id = nextFactionId++;
const palette = REBEL_COLORS[id % REBEL_COLORS.length];
FACTIONS[id] = { id, name: `${leaderName}反乱軍`, color: palette.color, bg: palette.bg, targetCastleId: null };
return id;
}

// --- v2 追加: セーブ / ロード（localStorage） ---
function saveGame() {
try {
const terrainById = {};
Object.values(TERRAIN).forEach(t => { terrainById[t.id] = t;});
const data = {
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
viewOfficerId: gameState.viewOfficerId,
setupDone: gameState.setupDone,
dayResumeIdx: (typeof gameState.dayResumeIdx === 'number') ? gameState.dayResumeIdx : null,
pendingRebellion: gameState.pendingRebellion || null,
pendingPhase: gameState.pendingPhase || null,
activePhase: gameState.activePhase || null,
activeOfficerId: gameState.activeOfficerId || null,
chronicle: gameState.chronicle || [],
mapSize: gameState.mapSize || 'standard',
mapCols: MAP_COLS,
mapRows: MAP_ROWS
};
localStorage.setItem(SAVE_KEY, JSON.stringify(data));
} catch (e) { /* 保存できない環境では無視する */}
}

function loadGame() {
try {
const raw = localStorage.getItem(SAVE_KEY);
if (!raw) return false;
const data = JSON.parse(raw);
const terrainById = {};
Object.values(TERRAIN).forEach(t => { terrainById[t.id] = t;});
if (data.mapCols && data.mapRows) { MAP_COLS = data.mapCols; MAP_ROWS = data.mapRows; }
gameState.mapSize = data.mapSize || (MAP_COLS > 14 ? 'large' : 'standard');
if (!Array.isArray(data.terrainIds) || !Array.isArray(data.castles) || !Array.isArray(data.officers)) return false;
const restoredGrid = data.terrainIds.map((row, r) => row.map((tid, q) => ({ q, r, terrain: terrainById[tid] || TERRAIN.PLAIN})));
gameState.day = data.day;
gameState.selectedCastleId = data.selectedCastleId;
gameState.unifiedAchieved = data.unifiedAchieved;
gameState.endlessMode = data.endlessMode;
gameState.castles = data.castles;
gameState.officers = data.officers;
gameState.armies = data.armies || [];
gameState.mapGrid = restoredGrid;
gameState.territory = (Array.isArray(data.territoryIds) && data.territoryIds.length === MAP_ROWS) ? data.territoryIds : null;
if (!gameState.territory) initTerritory();
gameState.development = (Array.isArray(data.developmentIds) && data.developmentIds.length === MAP_ROWS) ? data.developmentIds : null;
if (!gameState.development) initDevelopment();
Object.keys(FACTIONS).forEach(k => delete FACTIONS[k]);
Object.assign(FACTIONS, data.factions);
nextFactionId = data.nextFactionId || (gameState.mapSize === 'large' ? 8 : 6);
gameState.humans = Array.isArray(data.humans) ? data.humans : [];
gameState.viewOfficerId = data.viewOfficerId || (gameState.humans[0] && gameState.humans[0].officerId) || null;
gameState.setupDone = data.setupDone !== false;
gameState.dayResumeIdx = (typeof data.dayResumeIdx === 'number') ? data.dayResumeIdx : null;
gameState.pendingRebellion = data.pendingRebellion || null;
gameState.pendingPhase = data.pendingPhase || null;
gameState.activePhase = data.activePhase || null;
gameState.activeOfficerId = data.activeOfficerId || null;
// リモート担当の保留フェイズは復元しない（オフライン再開ではその手番を飛ばす）
if (gameState.pendingPhase) {
    const po = gameState.officers.find(o => o.id === gameState.pendingPhase.officerId);
    if (po && po.control === 'remote') gameState.pendingPhase = null;
}
if (gameState.activeOfficerId) {
    const ao = gameState.officers.find(o => o.id === gameState.activeOfficerId);
    if (ao && ao.control === 'remote') { gameState.activePhase = null; gameState.activeOfficerId = null; }
}
// v8: 決起判断の保留を復元したら、判断モーダルを出し直す
if (gameState.pendingRebellion && typeof promptRebellionDecision === 'function') { rebellionPromptKey = null; promptRebellionDecision(); }
// v8 review fix: 旧形式のセーブでも兵科・成長・戦績が欠けないよう補完する
gameState.officers.forEach(o => {
    if (!o.troopType) o.troopType = defaultTroopType(o);
    o.xp = o.xp || { valor: 0, leadership: 0, intellect: 0 };
    o.growth = o.growth || { valor: 0, leadership: 0, intellect: 0 };
    o.stats = o.stats || { castlesTaken: 0, battlesWon: 0 };
});
gameState.selectedTile = null;
gameState.chronicle = Array.isArray(data.chronicle) ? data.chronicle : [];
if (gameState.endlessMode) {
document.getElementById('endless-banner').classList.remove('hidden');
}
return true;
} catch (e) {
return false;
}
}

function resetGame() {
try { localStorage.removeItem(SAVE_KEY);} catch (e) { /* noop */}
location.reload();
}

// --- 初期化処理 ---
function initGame(mapSize) {
    // v8: マップサイズの適用（標準/大）。反乱勢力IDの発番もサイズで変わる
    if (mapSize && MAP_SIZES[mapSize]) gameState.mapSize = mapSize;
    const sizeDef = MAP_SIZES[gameState.mapSize] || MAP_SIZES.standard;
    MAP_COLS = sizeDef.cols;
    MAP_ROWS = sizeDef.rows;
    nextFactionId = gameState.mapSize === 'large' ? 8 : 6;
    // v8 review fix: 勢力定義を初期状態に戻す（前ゲームの反乱勢力やロードで欠けた大マップ勢力を引き継がない）
    Object.keys(FACTIONS).forEach(k => delete FACTIONS[k]);
    Object.assign(FACTIONS, JSON.parse(JSON.stringify(FACTIONS_MASTER)));
    gameState.pendingRebellion = null;
    gameState.chronicle = [];
    gameState.selectedTile = null;
    gameState.mapGrid = [];
    for (let r = 0; r < MAP_ROWS; r++) {
        const row = [];
        for (let q = 0; q < MAP_COLS; q++) {
            let t = TERRAIN.PLAIN;
            const rand = Math.random();
            const riverQ = Math.floor(MAP_COLS * 0.43);
            if (q === riverQ || q === riverQ + 1) {
                if (r >= 2 && r <= MAP_ROWS - 3 && rand < 0.55) t = TERRAIN.RIVER;
            }
            if (t === TERRAIN.PLAIN) {
                if (rand < 0.22) t = TERRAIN.FOREST;
                else if (rand < 0.34) t = TERRAIN.MOUNTAIN;
            }
            row.push({ q, r, terrain: t });
        }
        gameState.mapGrid.push(row);
    }

    gameState.castles = (gameState.mapSize === 'large' ? LARGE_CASTLES : STD_CASTLES).map(c => ({ ...c }));

     gameState.castles.forEach(c => {
gameState.mapGrid[c.r][c.q].terrain = TERRAIN.PLAIN;
c.lastNpcAttackDay = -999;
});
    initTerritory(); // v7: 初期領地（各城のマス＋周囲1マス）

    const player = {
        id: 'h1',
        name: 'プレイヤー1',
        humanId: 'h1',
        isPlayer: true,
        trait: null,
        valor: 76,
        leadership: 74,
        intellect: 84,
        castleId: null,
        gold: 250,
        troops: 500,
        merit: 0,
        loyalty: 100,
        nextPersonalDay: 4,
        nextStrategyDay: null,
        isMoving: false
    };
    gameState.humans = [{ id: 'h1', officerId: 'h1', label: 'P1', color: '#38bdf8' }];
    gameState.viewOfficerId = 'h1';

    const npcConfigs = gameState.mapSize === 'large' ? LARGE_NPC_CONFIGS : STD_NPC_CONFIGS;

    const NPC_TRAITS = gameState.mapSize === 'large' ? LARGE_NPC_TRAITS : STD_NPC_TRAITS;
    gameState.officers = [player];
    npcConfigs.forEach((cfg, idx) => {
        const interval = calcActionInterval(cfg);
        gameState.officers.push({
            ...cfg,
            trait: NPC_TRAITS[cfg.id] || null,
            humanId: null,
            isPlayer: false,
            nextPersonalDay: 2 + (idx % interval),
            nextStrategyDay: null,
            isMoving: false
        });
    });

    // v8: 兵科と成長の初期化
    gameState.officers.forEach(o => {
        if (!o.troopType) o.troopType = defaultTroopType(o);
        o.xp = o.xp || { valor: 0, leadership: 0, intellect: 0 };
        o.growth = o.growth || { valor: 0, leadership: 0, intellect: 0 };
        o.stats = o.stats || { castlesTaken: 0, battlesWon: 0 };
    });

    syncCastleLords();
    gameState.officers.forEach(o => {
        if (isCastleLord(o)) {
            const interval = calcActionInterval(o);
            o.nextStrategyDay = o.nextPersonalDay + Math.floor(interval / 2);
        }
    });

    addLog('乱世の幕が開けました。あなたは現在「浪人」です。まずは好みの城へ仕官しましょう。', 'phase');
    updateUI();
    drawMap();
}

// --- 役職・階層ロジック ---

function getCastleOfficers(castleId) {
    return gameState.officers
        .filter(o => o.castleId === castleId && !o.isMoving)
        .sort((a, b) => b.merit - a.merit);
}

function getCastleLord(castleId) {
    const list = getCastleOfficers(castleId);
    return list.length > 0 ? list[0] : null;
}

function isCastleLord(officer) {
    if (!officer.castleId || officer.isMoving) return false;
    const lord = getCastleLord(officer.castleId);
    return lord && lord.id === officer.id;
}

// v9 stage E: 行軍中も含めた、その城の最上位の武将（功績順）
function castleTopOfficer(castleId) {
    const castle = gameState.castles.find(c => c.id === castleId);
    const list = gameState.officers.filter(o => {
        if (o.castleId !== castleId) return false;
        if (!o.isMoving) return true;
        const army = gameState.armies.find(a => a.commanderId === o.id);
        return !!army && !!castle && army.factionId === castle.factionId; // v9 stage E review fix: 陥落した城に旧勢力の行軍中武将を数えない
    }).sort((a, b) => b.merit - a.merit);
    return list.length > 0 ? list[0] : null;
}

// v9 stage E: 行軍中だが本来その城の城主である武将（本拠地が自勢力のままのときだけ）
function isMarchingLord(officer) {
    if (!officer || !officer.isMoving || !officer.castleId) return false;
    const castle = gameState.castles.find(c => c.id === officer.castleId);
    if (!castle) return false;
    const army = gameState.armies.find(a => a.commanderId === officer.id);
    if (!army || castle.factionId !== army.factionId) return false; // 武将に勢力IDはなく、率いる部隊の勢力で判定する
    const top = castleTopOfficer(officer.castleId);
    return !!top && top.id === officer.id;
}

function isFactionRuler(officer) {
    if (!isCastleLord(officer)) return false;
    const castle = gameState.castles.find(c => c.id === officer.castleId);
    if (!castle || castle.factionId === 0) return false;
    
    const factionCastles = gameState.castles.filter(c => c.factionId === castle.factionId);
    let topLord = null;
    factionCastles.forEach(fc => {
        const l = getCastleLord(fc.id);
        if (l && (!topLord || l.merit > topLord.merit)) {
            topLord = l;
        }
    });
    return topLord && topLord.id === officer.id;
}

function syncCastleLords() {
    gameState.castles.forEach(castle => {
        const lord = getCastleLord(castle.id);
        const members = getCastleOfficers(castle.id);
        members.forEach(m => {
            if (lord && m.id === lord.id) {
                if (m.nextStrategyDay === null) {
                    const interval = calcActionInterval(m);
                    m.nextStrategyDay = gameState.day + Math.max(2, Math.floor(interval / 2));
                    if (isHuman(m)) {
                        addLog(`${m.name}が功績トップとなり「${castle.name}」の城主に就任しました！戦略フェイズが解禁されます。`, 'good');
                    }
                }
            } else {
                if (m.nextStrategyDay !== null) {
                    if (isHuman(m)) {
                        addLog(`${m.name}が城内の他武将に功績を抜かれ、「${castle.name}」の城主の座を失いました。`, 'warn');
                    }
                    m.nextStrategyDay = null;
                }
            }
        });
    });
}

// --- UI更新・モーダル表示 ---

function getPlayer() {
    const id = gameState.activeOfficerId || gameState.viewOfficerId || (gameState.humans[0] && gameState.humans[0].officerId);
    return gameState.officers.find(o => o.id === id) || gameState.officers.find(o => o.humanId) || null;
}