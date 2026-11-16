// CHRONICLE OF BETRAYAL — data.js: 定数・勢力・地形・特性・イベント文などのデータ定義
/**
 * ============================================================================
 * CHRONICLE OF BETRAYAL - 非同期ターン制 戦略・陣取りシミュレーション
 * ============================================================================
 * 【v2 救済版 2026-11-15】個人兵力制・訓練・独立出陣を実装し、反乱勢力ID、経済上限、NPC出陣間引き、地形と統率の移動反映、セーブ機能を追加。
 * 【改造・拡張ガイド】
 * - マップの広さや城の配置は `initGame()` の `gameState.castles` で調整可能です。
 * - キャラクターの初期能力値や行動周期は `calcActionInterval()` で変更できます。
 * - 新しいコマンドを追加したい場合は、対応するアクション関数と `renderCommandPanel()` 内のボタン追加を行ってください。
 */

// --- 定数・設定 ---
// v8: マップサイズは初期化時に切り替わる（標準 14x10 / 大 18x13）
let MAP_COLS = 14;
let MAP_ROWS = 10;
const MAP_SIZES = {
    standard: { cols: 14, rows: 10, label: '標準' },
    large: { cols: 18, rows: 13, label: '大マップ' }
};
const DAYS_PER_HEX = 4;        // 1マス移動に必要な日数
const MAX_CASTLE_OFFICERS = 5; // 1城あたりの最大所属人数
const PAYDAY_INTERVAL = 30; // 給与・収入決済サイクル（30日ごと）
const ECONOMY_MAX = 300; // v2: 城の経済上限（内政の無限膨張を止める）
const ECONOMY_MIN = 50; // v6: 内政の下限（籠城で荒廃してもここまで）
const SIEGE_ECONOMY_DAMAGE = 20; // v6: 城で戦闘が起きるたびの内政低下
const DOMESTIC_COST_G = 50; // v7: 内政の金コスト（フェイズを終わらせず連打できる代わりに払う）
const TRAIN_COST_G = 50; // v7: 訓練の金コスト
const COMMAND_COSTS = { attack: 200, recruit: 100, distribute: 50, embezzle: 50, policy: 50, domestic: 50, train: 50, emergencyLevy: 150, forcedMarch: 300, develop: 100 }; // v7/v8: 戦略行動の指導力コスト
const TERRITORY_INCOME_PER_TILE = 2;
// v8: 忠誠がこの値を下回ると反乱リスク圏（毎日確率判定、前兆通知あり）
const REBELLION_LOYALTY_THRESHOLD = 50;

// v8: 兵科（歩兵・騎兵・弓兵）。地形と攻城で倍率が変わる
const TROOP_TYPES = {
    infantry: { id: 'infantry', name: '歩兵', desc: '攻城戦の攻撃・守備で +10%' },
    cavalry: { id: 'cavalry', name: '騎兵', desc: '平原の野戦で +15%、山岳・河川の野戦で -15%' },
    archer: { id: 'archer', name: '弓兵', desc: '森の野戦で +15%' }
};
const TROOP_TYPE_CHANGE_COST = 150;
const SAVE_KEY = 'chronicle_of_betrayal_v8'; // v2: 反乱などで新勢力を作るときの発番カウンタ
const REBEL_COLORS = [
{ color: '#a855f7', bg: 'rgba(168, 85, 247, 0.25)' },
{ color: '#f97316', bg: 'rgba(249, 115, 22, 0.25)' },
{ color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.25)' },
{ color: '#ec4899', bg: 'rgba(236, 72, 153, 0.25)' },
{ color: '#84cc16', bg: 'rgba(132, 204, 22, 0.25)' },
{ color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.25)' }
];

// 勢力カラー定義
const FACTIONS = {
    0: { id: 0, name: '無所属', color: '#64748b', bg: 'rgba(100, 116, 139, 0.25)', targetCastleId: null },
    1: { id: 1, name: '紅蓮騎士団', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.25)', targetCastleId: null },
    2: { id: 2, name: '蒼穹公国', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.25)', targetCastleId: null },
    3: { id: 3, name: '翡翠同盟', color: '#10b981', bg: 'rgba(16, 185, 129, 0.25)', targetCastleId: null },
    4: { id: 4, name: '黄金帝国', color: '#eab308', bg: 'rgba(234, 179, 8, 0.25)', targetCastleId: null },
    5: { id: 5, name: '紫電独立軍', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.25)', targetCastleId: null },
    // v8: 大マップ専用勢力（標準マップでは登場しない）
    6: { id: 6, name: '白銀聖教国', color: '#c0c8d8', bg: 'rgba(192, 200, 216, 0.25)', targetCastleId: null },
    7: { id: 7, name: '琥珀通商連合', color: '#a86830', bg: 'rgba(168, 104, 48, 0.25)', targetCastleId: null }
};
// v8 review fix: 勢力定義の初期状態マスター。反乱やロードで FACTIONS が書き換わるため、新規開始時にここから復元する
const FACTIONS_MASTER = JSON.parse(JSON.stringify(FACTIONS));

// 地形タイプ
// --- v8: 大マップ（15城・7勢力）の追加データ。座標は 18x13 用。名称・数値のたたき台はGemini作成、配置と勢力配分は調整済み ---
const LARGE_CASTLES_EXTRA = [
    { id: 10, name: 'セレスティア聖都', q: 15, r: 1, factionId: 6, troops: 3400, economy: 165, treasury: 620 },
    { id: 11, name: 'フロストヘルム要塞', q: 17, r: 4, factionId: 6, troops: 3000, economy: 125, treasury: 410 },
    { id: 12, name: 'ミラージュ城', q: 13, r: 8, factionId: 4, troops: 3200, economy: 140, treasury: 490 },
    { id: 13, name: 'ドラグーン砦', q: 16, r: 11, factionId: 7, troops: 3500, economy: 115, treasury: 380 },
    { id: 14, name: 'ルミナリア交易都市', q: 8, r: 11, factionId: 7, troops: 3300, economy: 170, treasury: 640 },
    { id: 15, name: 'テンペスト関門', q: 4, r: 10, factionId: 5, troops: 3600, economy: 130, treasury: 450 }
];
const LARGE_NPC_CONFIGS_EXTRA = [
    { id: 'npc17', name: 'ユリウス',       valor: 68, leadership: 86, intellect: 88, castleId: 10, troops: 2700, merit: 310, loyalty: 100, gold: 520 },
    { id: 'npc18', name: 'クラリス',       valor: 62, leadership: 74, intellect: 82, castleId: 10, troops: 1450, merit: 180, loyalty: 78,  gold: 190 },
    { id: 'npc19', name: 'ジークフリート', valor: 89, leadership: 84, intellect: 64, castleId: 11, troops: 2600, merit: 300, loyalty: 100, gold: 440 },
    { id: 'npc20', name: 'ギルバート',     valor: 81, leadership: 76, intellect: 58, castleId: 11, troops: 1500, merit: 160, loyalty: 74,  gold: 160 },
    { id: 'npc21', name: 'エレオノーラ',   valor: 72, leadership: 80, intellect: 85, castleId: 12, troops: 2350, merit: 290, loyalty: 100, gold: 470 },
    { id: 'npc22', name: 'フェリクス',     valor: 75, leadership: 70, intellect: 73, castleId: 12, troops: 1350, merit: 140, loyalty: 72,  gold: 175 },
    { id: 'npc23', name: 'ヴォルフガング', valor: 90, leadership: 78, intellect: 60, castleId: 13, troops: 2500, merit: 305, loyalty: 100, gold: 400 },
    { id: 'npc24', name: 'ザックス',       valor: 83, leadership: 68, intellect: 56, castleId: 13, troops: 1550, merit: 150, loyalty: 70,  gold: 150 },
    { id: 'npc25', name: 'コルネリア',     valor: 58, leadership: 82, intellect: 90, castleId: 14, troops: 2800, merit: 320, loyalty: 100, gold: 550 },
    { id: 'npc26', name: 'ディートリヒ',   valor: 66, leadership: 79, intellect: 84, castleId: 14, troops: 1600, merit: 220, loyalty: 76,  gold: 215 },
    { id: 'npc27', name: 'ヴァルター',     valor: 85, leadership: 87, intellect: 71, castleId: 15, troops: 2400, merit: 295, loyalty: 100, gold: 430 },
    { id: 'npc28', name: 'ナタリア',       valor: 78, leadership: 72, intellect: 69, castleId: 15, troops: 1300, merit: 130, loyalty: 75,  gold: 165 }
];
const LARGE_NPC_TRAITS_EXTRA = { npc17: 'loyal', npc18: 'domestic', npc19: 'brave', npc20: 'drill', npc21: 'fame', npc22: 'swift', npc23: 'brave', npc24: 'wealth', npc25: 'domestic', npc26: 'fame', npc27: 'ironwall', npc28: 'swift' };

const TERRAIN = {
    PLAIN: { id: 0, name: '平原', color: '#1a2e22', stroke: '#233d2d' },
    FOREST: { id: 1, name: '森', color: '#132419', stroke: '#1b3324' },
    MOUNTAIN: { id: 2, name: '山岳', color: '#292524', stroke: '#3f3a38' },
    RIVER: { id: 3, name: '河川', color: '#172554', stroke: '#1e3a8a' }
};

// --- v4 追加: 特性定義（文案はGemini作成） ---
const TRAITS = {
    brave: { name: '猛将', desc: '前線での戦闘力が高く、敵部隊に大ダメージを与える。' },
    ironwall: { name: '鉄壁', desc: '防御の指揮に長け、自軍の被害を大きく抑える。' },
    domestic: { name: '能吏', desc: '城の開発や内政を効率よく進められる。' },
    drill: { name: '教官', desc: '私兵の訓練が素早く進み、精鋭を育てやすい。' },
    swift: { name: '神速', desc: '行軍の足並みが速く、戦場を素早く駆け巡る。' },
    loyal: { name: '忠義', desc: '主君への忠誠心が厚く、不満を抱きにくい。' },
    fame: { name: '武勲', desc: '働きが周囲の目を引きやすく、功績が多くなる。' },
    wealth: { name: '商才', desc: 'やりくりが巧みで、毎期の資金収入が増える。' }
};

// --- v4 追加: ランダムイベント（文案はGemini作成） ---
const WORLD_EVENT_TEXTS = [
    { title: '実りの秋と大豊作', body: '{castle}周辺の農村で異例の大豊作となった。領主{lord}のもとへ多くの年貢が運び込まれている。' },
    { title: '流行り病の蔓延', body: '{castle}の城下町で原因不明の疫病が流行している。{lord}は施療院を開いて対応に追われている。' },
    { title: '異国からの大商隊', body: '遠い異国からラクダを連ねた大商隊が{castle}に到着した。活気ある取引で城下が賑わっている。' },
    { title: '荒くれ傭兵団の出現', body: '{castle}の近隣に歴戦の傭兵団が野営を張った。{lord}が金貨を積めば有力な戦力になりそうだ。' },
    { title: 'くすぶる反乱の火種', body: '重税に苦しむ{castle}の領民たちが不穏な動きを見せている。{lord}の手腕が試される時だ。' },
    { title: '新たな名産品の発見', body: '{castle}の山あいで良質な鉱脈と特産品が見つかった。{lord}の新たな財源として期待されている。' }
];
const PERSONAL_EVENT_TEXTS = [
    { title: '思わぬ拾い物', body: '城下を見回り中だった{officer}は、道端で忘れられた金貨入りの革袋を見つけて懐に収めた。' },
    { title: '旧友との再会', body: '酒場で偶然、昔の戦友と再会した{officer}は、夜遅くまで語り合って大いに士気を高めた。' },
    { title: '実を結んだ猛訓練', body: '{officer}が日頃から続けていた厳しい鍛錬が実を結び、私兵たちの動きが見違えるほど精悍になった。' },
    { title: '旅の行商人との取引', body: '珍しい武具を扱う行商人が{officer}のもとを訪れた。掘り出し物を手に入れてご満悦のようだ。' },
    { title: '酒場で聞いた噂話', body: '{officer}は城下の酒場で隣国の内情に関する興味深い噂を耳にし、今後の戦略の参考にした。' },
    { title: '季節の変わり目の不調', body: '連日の激務が祟ったのか、{officer}は少し体調を崩してしまい、しばらく静養することになった。' }
];
const VISITOR_NAMES = ['ジークフリート', 'エレノア', 'トリスタン', 'クラリス', 'ギルバート', 'フィーネ', 'アルベール', 'ローゼリア', 'ザックス', 'ユーリ', 'ナタリア', 'レイヴン'];

// --- v4 追加: 対人戦セットアップ ---
const HUMAN_COLORS = ['#38bdf8', '#f472b6', '#a3e635', '#fbbf24'];
const HUMAN_LABELS = ['P1', 'P2', 'P3', 'P4'];
// --- 城・武将データ（標準は initGame から移植、大マップは標準＋追加分） ---
const STD_CASTLES = [
        { id: 1, name: 'ヴァルハラ城', q: 2, r: 2, factionId: 1, troops: 3500, economy: 140, treasury: 500 },
        { id: 2, name: 'アーク要塞',   q: 5, r: 1, factionId: 1, troops: 2800, economy: 110, treasury: 350 },
        { id: 3, name: 'ブルーム城',   q: 2, r: 7, factionId: 2, troops: 3600, economy: 150, treasury: 520 },
        { id: 4, name: 'リバーゲート', q: 6, r: 5, factionId: 2, troops: 2600, economy: 120, treasury: 380 },
        { id: 5, name: 'エメラルド砦', q: 10, r: 2, factionId: 3, troops: 3400, economy: 135, treasury: 480 },
        { id: 6, name: 'ソラリス王都', q: 11, r: 7, factionId: 4, troops: 4000, economy: 170, treasury: 650 },
        { id: 7, name: 'クレセント城', q: 8, r: 8, factionId: 3, troops: 3200, economy: 125, treasury: 420 },
        { id: 8, name: 'アイアンクラッド砦', q: 12, r: 4, factionId: 4, troops: 3500, economy: 145, treasury: 460 },
        { id: 9, name: 'シデン要塞', q: 0, r: 5, factionId: 5, troops: 3900, economy: 130, treasury: 430 }
    ];
const LARGE_CASTLES = STD_CASTLES.concat(LARGE_CASTLES_EXTRA);
const STD_NPC_CONFIGS = [
        { id: 'npc1', name: 'バルド公',   valor: 88, leadership: 85, intellect: 70, castleId: 1, troops: 2100, merit: 320, loyalty: 100, gold: 400 },
        { id: 'npc2', name: 'ミレナ',     valor: 65, leadership: 72, intellect: 86, castleId: 1, troops: 1400, merit: 140, loyalty: 75,  gold: 180 },
        { id: 'npc3', name: 'ガウェイン', valor: 82, leadership: 76, intellect: 60, castleId: 2, troops: 2800, merit: 240, loyalty: 80,  gold: 220 },
        { id: 'npc4', name: 'レオンハルト', valor: 84, leadership: 88, intellect: 82, castleId: 3, troops: 2200, merit: 350, loyalty: 100, gold: 450 },
        { id: 'npc5', name: 'セシリア',   valor: 60, leadership: 68, intellect: 90, castleId: 3, troops: 1400, merit: 150, loyalty: 78,  gold: 200 },
        { id: 'npc6', name: 'ダリウス',   valor: 79, leadership: 74, intellect: 65, castleId: 4, troops: 2600, merit: 210, loyalty: 72,  gold: 190 },
        { id: 'npc7', name: 'シルヴィア', valor: 75, leadership: 82, intellect: 88, castleId: 5, troops: 2000, merit: 300, loyalty: 100, gold: 380 },
        { id: 'npc8', name: 'ロイド',     valor: 80, leadership: 70, intellect: 62, castleId: 5, troops: 1400, merit: 120, loyalty: 68,  gold: 140 },
        { id: 'npc9', name: 'アウグスト', valor: 90, leadership: 86, intellect: 80, castleId: 6, troops: 2400, merit: 380, loyalty: 100, gold: 550 },
        { id: 'npc10', name: 'カイン',    valor: 77, leadership: 73, intellect: 71, castleId: 6, troops: 1600, merit: 160, loyalty: 70,  gold: 170 },
        { id: 'npc11', name: 'セレナ',     valor: 72, leadership: 78, intellect: 85, castleId: 7, troops: 1900, merit: 290, loyalty: 100, gold: 360 },
        { id: 'npc12', name: 'オルフェ',   valor: 83, leadership: 69, intellect: 58, castleId: 7, troops: 1300, merit: 130, loyalty: 74,  gold: 150 },
        { id: 'npc13', name: 'ヴェルナー', valor: 86, leadership: 80, intellect: 66, castleId: 8, troops: 2300, merit: 330, loyalty: 100, gold: 420 },
        { id: 'npc14', name: 'ミーシャ',   valor: 63, leadership: 75, intellect: 79, castleId: 8, troops: 1200, merit: 110, loyalty: 71,  gold: 160 },
        { id: 'npc15', name: 'ライガ',     valor: 89, leadership: 77, intellect: 64, castleId: 9, troops: 2400, merit: 310, loyalty: 100, gold: 400 },
        { id: 'npc16', name: 'ハヤテ',     valor: 81, leadership: 84, intellect: 55, castleId: 9, troops: 1500, merit: 170, loyalty: 76,  gold: 210 }
    ];
const LARGE_NPC_CONFIGS = STD_NPC_CONFIGS.concat(LARGE_NPC_CONFIGS_EXTRA);
const STD_NPC_TRAITS = { npc1: 'brave', npc2: 'domestic', npc3: 'brave', npc4: 'fame', npc5: 'domestic', npc6: 'wealth', npc7: 'loyal', npc8: 'swift', npc9: 'ironwall', npc10: 'drill', npc11: 'domestic', npc12: 'swift', npc13: 'ironwall', npc14: 'loyal', npc15: 'brave', npc16: 'drill' };
const LARGE_NPC_TRAITS = Object.assign({}, STD_NPC_TRAITS, LARGE_NPC_TRAITS_EXTRA);
