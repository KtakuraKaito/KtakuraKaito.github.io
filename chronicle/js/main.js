// CHRONICLE OF BETRAYAL — main.js: ボタン配線と起動処理


document.getElementById('setup-start').onclick = confirmSetup;
document.getElementById('handover-begin').onclick = beginHumanPhase;
document.getElementById('net-create').onclick = netCreateRoom;
document.getElementById('net-join').onclick = netJoinRoom;
document.getElementById('net-close').onclick = closeNetModal;
document.getElementById('net-skip').onclick = netSkipRemotePhase;
document.getElementById('setup-online').onclick = () => { document.getElementById('setup-overlay').classList.add('hidden'); openNetModal(); };

document.getElementById('btn-save-game').onclick = () => {
saveGame();
addLog('現在の状態を保存しました。', 'good');
};

document.getElementById('btn-reset-game').onclick = () => {
showModal('最初からやり直す', '<p>セーブデータを消して、最初からやり直しますか？</p>', [
{ text: 'キャンセル', class: 'bg-slate-700 text-slate-200', onClick: closeModal},
{ text: '消して最初から', class: 'bg-rose-600 text-white font-bold', onClick: resetGame}
]);
};

document.getElementById('btn-step-day').onclick = () => {
    stopAutoPlay();
    advanceOneDay();
};

document.getElementById('btn-next-phase').onclick = () => {
    stopAutoPlay();
    if (gameState.activePhase !== null) return;
    let safety = 0;
    while (gameState.activePhase === null && !gameState.pendingPhase && safety < 120) {
        advanceOneDay();
        safety++;
    }
};

document.getElementById('btn-auto-toggle').onclick = () => {
    if (gameState.autoHalted) {
        gameState.autoHalted = false;
        updateAutoButton();
        startAutoTimer();
    } else if (gameState.autoPlay) {
        stopAutoPlay();
    } else {
        if (gameState.activePhase !== null) return;
        gameState.autoPlay = true;
        updateAutoButton();
        startAutoTimer();
    }
};

window.onload = () => {
if (loadGame()) {
addLog('セーブデータを読み込みました。前回の続きから再開します。', 'phase');
if (!gameState.humans.length) {
    gameState.officers.filter(o => o.humanId).forEach((o, i) => gameState.humans.push({ id: o.humanId, officerId: o.id, label: 'P' + (i + 1), color: HUMAN_COLORS[i] || '#38bdf8' }));
    gameState.viewOfficerId = gameState.humans[0] ? gameState.humans[0].officerId : null;
}
syncCastleLords();
checkPlayerStatusEvents();
updateUI();
drawMap();
document.getElementById('endless-banner').classList.toggle('hidden', !gameState.endlessMode); // v8 review fix: バナー表示を復元状態に合わせる
if (gameState.pendingPhase) showHandover(); // v8 fix: 保留中の手番を復元したら交代画面から再開する
} else {
initGame();
showSetup();
}
resizeCanvas();
};
// v8: セットアップ画面のマップサイズ切り替え（世界を作り直して城の選択肢を更新する）
document.getElementById('setup-mapsize').onchange = (e) => {
    initGame(e.target.value);
    renderSetupSlots();
    drawMap();
};

// v8: 戦績ボタンと強制中継チェックボックス
document.getElementById('btn-chronicle').onclick = () => { openChronicleModal(); };
const relayBox = document.getElementById('net-relay-only');
if (relayBox) {
    relayBox.checked = netRelayOnly();
    relayBox.onchange = () => {
        try { localStorage.setItem('cob-relay-only', relayBox.checked ? '1' : '0'); } catch (e) { /* noop */ }
        netSetStatus(relayBox.checked ? '強制中継モードを有効にしました。次に作る/参加する接続から適用されます。' : '強制中継モードを無効にしました。次に作る/参加する接続から適用されます。');
    };
}
