// 전역 변수들
let zoom = 30;
let viewOffset = {
    x: 0,
    y: 0
};
let isPanning = false;
let lastMousePos = {
    x: 0,
    y: 0
};

let isPlaying = false;
let isPaused = false;
let startTime = 0;
let elapsedTime = 0;
let animationFrameId = null;

let countdownTimer = null;
let demoAudio = new Audio();
let audioFileURL = null;
let savedAudioFile = null; // 저장된 오디오 파일 정보

let highlightedNoteIndex = null;
let highlightedNoteTimer = 0;

let globalAnimationFrameId = null;
let isDrawLoopRunning = false;

let musicVolume = 0.5; // 0.0 ~ 1.0
let sfxVolume = 1.0; // 0.0 ~ 1.0

const demoPlayer = {
    x: 0,
    y: 0
};

// DOM 요소
const inputAudio = document.getElementById("audio-file");
const btnDemoPlay = document.getElementById("demo-play");
const btnDemoPause = document.getElementById("demo-pause");
const btnDemoStop = document.getElementById("demo-stop");
const spanDemoTime = document.getElementById("demo-time");
const seekbar = document.getElementById("demo-seekbar");

const notes = [];
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// 음향 그래프 관련 변수
const waveformCanvas = document.getElementById("waveform-canvas");
const waveformCtx = waveformCanvas.getContext("2d");
const waveformContainer = document.getElementById("waveform-container");
const waveformProgress = document.getElementById("waveform-progress");
const rulerCanvas = document.getElementById("ruler-canvas");
const rulerCtx = rulerCanvas.getContext("2d");
const waveformSlider = document.getElementById("waveform-slider");
let audioBuffer = null;
let waveformData = null;
let waveformZoom = 1;
let waveformOffset = 0;
let pathHighlightTimer = 0;
let hasAudioFile = false; // 오디오 파일 로드 상태 추가

// 노트 사운드 관련 변수
let tabSoundPool = []; // Tab 사운드 풀
let directionSoundPool = []; // Direction 사운드 풀
let playedNotes = new Set(); // 이미 재생된 노트들을 추적
const SOUND_POOL_SIZE = 10; // 동시 재생 가능한 사운드 수
// 음악 시작 시간 (고정값: 3초)
const MUSIC_START_TIME = 3.0;

// Pre-delay 값을 가져오는 함수
function getPreDelaySeconds() {
    const preDelayMs = parseInt(document.getElementById("pre-delay").value || 0);
    return preDelayMs / 1000;
}

// 사운드 파일 로드
function loadNoteSounds() {
    try {
        // Tab 사운드 풀 생성 (sfx/tab.mp3 사용)
        tabSoundPool = [];
        for (let i = 0; i < SOUND_POOL_SIZE; i++) {
            const audio = new Audio('sfx/tab.mp3');
            audio.volume = 1.0;
            audio.preload = 'auto';
            tabSoundPool.push(audio);
        }

        // Direction 사운드 풀 생성 (tab.mp3와 동일한 파일 사용)
        directionSoundPool = [];
        for (let i = 0; i < SOUND_POOL_SIZE; i++) {
            const audio = new Audio('sfx/tab.mp3'); // 동일한 파일 사용
            audio.volume = 1.0;
            audio.preload = 'auto';
            directionSoundPool.push(audio);
        }

        console.log(`Note sound pools loaded: ${SOUND_POOL_SIZE} instances each (using sfx/tab.mp3)`);
    } catch (error) {
        console.warn('Failed to load note sounds:', error);
        tabSoundPool = [];
        directionSoundPool = [];
    }
}

// 사용 가능한 사운드 인스턴스 찾기
function getAvailableSound(soundPool) {
    // 재생이 끝났거나 아직 재생되지 않은 인스턴스 찾기
    for (let audio of soundPool) {
        if (audio.paused || audio.ended || audio.currentTime === 0) {
            return audio;
        }
    }

    // 모든 인스턴스가 사용 중이면 가장 오래된 것을 재사용
    // (currentTime이 가장 큰 것 = 가장 오래 재생된 것)
    let oldestAudio = soundPool[0];
    let maxCurrentTime = soundPool[0].currentTime;

    for (let audio of soundPool) {
        if (audio.currentTime > maxCurrentTime) {
            maxCurrentTime = audio.currentTime;
            oldestAudio = audio;
        }
    }

    return oldestAudio;
}

// 노트 사운드 재생
function playNoteSound(noteType) {
    try {
        let audio = null;

        if (noteType === 'tab' && tabSoundPool.length > 0) {
            audio = getAvailableSound(tabSoundPool);
        } else if (noteType === 'direction' && directionSoundPool.length > 0) {
            audio = getAvailableSound(directionSoundPool);
        }

        if (audio) {
            audio.currentTime = 0; // 처음부터 재생
            audio.play().catch(e => {
                console.warn(`${noteType} sound play failed:`, e);
            });
        }
    } catch (error) {
        console.warn('Error playing note sound:', error);
    }
}

// 노트 히트 체크 (플레이어가 노트를 지났는지 확인)
function checkNoteHits(currentTime) {
    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    const tolerance = 0.05;

    notes.forEach((note, index) => {
        const noteId = `${note.type}-${note.beat}-${index}`;

        if (playedNotes.has(noteId))
            return;

        let targetTime;
        if (note.beat === 0 && note.type === "direction") {
            targetTime = 0;
            // 수정: 0번 direction 노트는 효과음 재생하지 않고 바로 리턴
            if (currentTime >= targetTime - tolerance && currentTime <= targetTime + tolerance) {
                playedNotes.add(noteId);
                highlightNoteHit(index);
                console.log(`0번 노트 통과 (효과음 없음): beat ${note.beat}, time ${currentTime.toFixed(3)}s`);
            }
            return; // 효과음 재생 없이 종료
        } else {
            const originalTime = beatToTime(note.beat, bpm, subdivisions);
            targetTime = originalTime + preDelaySeconds;
        }

        if (currentTime >= targetTime - tolerance &&
            currentTime <= targetTime + tolerance) {

            playNoteSound(note.type); // 0번 노트가 아닌 경우만 효과음 재생
            playedNotes.add(noteId);
            highlightNoteHit(index);

            console.log(`Note hit: ${note.type} at beat ${note.beat}, time ${targetTime.toFixed(3)}s`);
        }
    });
}

// 노트 히트 시각적 피드백
function highlightNoteHit(noteIndex) {
    highlightedNoteIndex = noteIndex;
    highlightedNoteTimer = 0.3; // 0.3초간 하이라이트

    if (!isDrawLoopRunning) {
        isDrawLoopRunning = true;
        drawLoop();
    }
}

// 재생 상태 리셋 (정지 또는 새로운 재생 시)
function resetPlayedNotes() {
    playedNotes.clear();
    console.log('Played notes reset');
}

// BPM과 분박을 시간으로 변환하는 함수
function beatToTime(beat, bpm, subdivisions) {
    return (beat * 60) / (bpm * subdivisions);
}

// 시간을 분박으로 변환하는 함수
function timeToBeat(time, bpm, subdivisions) {
    return Math.round((time * bpm * subdivisions) / 60);
}

// BPM/Subdivisions 변경 시 시간 기반으로 노트 업데이트
function updateNotesForTimeBasedChange(oldBpm, oldSubdivisions, newBpm, newSubdivisions) {
    console.log(`Updating notes from BPM ${oldBpm}/${oldSubdivisions} to ${newBpm}/${newSubdivisions}`);

    // 각 노트의 시간을 계산하고 새로운 BPM/subdivisions로 비트 재계산
    notes.forEach(note => {
        // 기존 설정으로 시간 계산
        const timeInSeconds = beatToTime(note.beat, oldBpm, oldSubdivisions);

        // 새로운 설정으로 비트 재계산
        note.beat = timeToBeat(timeInSeconds, newBpm, newSubdivisions);

        console.log(`Note: ${timeInSeconds.toFixed(3)}s -> beat ${note.beat}`);
    });

    // 비트 0인 direction 노트 확실히 유지
    ensureInitialDirectionNote();
}

// BPM 필드 변경 핸들러
function handleBpmChange(newBpm) {
    const oldBpm = parseFloat(document.getElementById("bpm").dataset.previousValue || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);

    console.log(`BPM changed from ${oldBpm} to ${newBpm}`);

    if (oldBpm !== newBpm && notes.length > 0) {
        updateNotesForTimeBasedChange(oldBpm, subdivisions, newBpm, subdivisions);
    }

    // 이전 값 저장
    document.getElementById("bpm").dataset.previousValue = newBpm;

    saveToStorage();
    drawPath();
    renderNoteList();
    if (waveformData)
        drawWaveform();
}

// Subdivisions 필드 변경 핸들러
function handleSubdivisionsChange(newSubdivisions) {
    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const oldSubdivisions = parseInt(document.getElementById("subdivisions").dataset.previousValue || 16);

    console.log(`Subdivisions changed from ${oldSubdivisions} to ${newSubdivisions}`);

    if (oldSubdivisions !== newSubdivisions && notes.length > 0) {
        updateNotesForTimeBasedChange(bpm, oldSubdivisions, bpm, newSubdivisions);
    }

    // 이전 값 저장
    document.getElementById("subdivisions").dataset.previousValue = newSubdivisions;

    saveToStorage();
    drawPath();
    renderNoteList();
    if (waveformData)
        drawWaveform();
}

// Pre-delay 변경 핸들러
function handlePreDelayChange() {
    console.log(`Pre-delay changed to ${getPreDelaySeconds()}s`);

    saveToStorage();
    renderNoteList(); // 노트 리스트 즉시 업데이트
    if (waveformData)
        drawWaveform();
}

// 플로팅 기능 설정
function setupWaveformFloating() {
    const container = document.getElementById('waveform-container');
    const triggerZone = document.querySelector('.waveform-trigger-zone');

    if (!container || !triggerZone) {
        console.error('Container or trigger zone not found');
        return;
    }

    console.log('Setting up waveform floating...');

    // 트리거 영역에 마우스 진입
    triggerZone.addEventListener('mouseenter', () => {
        console.log('Mouse entered trigger zone');
        container.classList.add('visible');
    });

    // 컨테이너에 마우스가 있을 때 계속 표시
    container.addEventListener('mouseenter', () => {
        console.log('Mouse entered container');
        container.classList.add('visible');
    });

    // 컨테이너에서 마우스가 완전히 벗어날 때만 숨김
    container.addEventListener('mouseleave', (e) => {
        console.log('Mouse left container');
        // 약간의 딜레이를 주어 실수로 숨겨지는 것을 방지
        setTimeout(() => {
            if (!container.matches(':hover')) {
                container.classList.remove('visible');
            }
        }, 100);
    });

    // 전역 마우스 움직임으로 추가 제어
    document.addEventListener('mousemove', (e) => {
        const windowHeight = window.innerHeight;
        const triggerHeight = 30;

        // 마우스가 하단 30px 영역에 있고, 사이드바 영역이 아닐 때
        if (e.clientY >= windowHeight - triggerHeight && e.clientX >= 400) {
            if (!container.classList.contains('visible')) {
                console.log('Mouse in bottom area, showing container');
                container.classList.add('visible');
            }
        }
    });

    console.log('Waveform floating setup complete');
}

// 음향 그래프 컨트롤 설정
function setupWaveformControls() {
    const zoomInBtn = document.getElementById('waveform-zoom-in');
    const zoomOutBtn = document.getElementById('waveform-zoom-out');
    const resetBtn = document.getElementById('waveform-reset');
    const zoomLevel = document.getElementById('waveform-zoom-level');

    zoomInBtn.addEventListener('click', () => {
        waveformZoom = Math.min(waveformZoom * 2, 16);
        updateZoomLevel();
        drawWaveform();
        updateWaveformSlider();
    });

    zoomOutBtn.addEventListener('click', () => {
        waveformZoom = Math.max(waveformZoom / 2, 0.25);
        updateZoomLevel();
        drawWaveform();
        updateWaveformSlider();
    });

    resetBtn.addEventListener('click', () => {
        waveformZoom = 1;
        waveformOffset = 0;
        updateZoomLevel();
        drawWaveform();
        updateWaveformSlider();
    });

    function updateZoomLevel() {
        zoomLevel.textContent = Math.round(waveformZoom * 100) + '%';
    }
}

// 더미 waveform 데이터 생성
function generateDummyWaveform(duration) {
    console.log('Generating dummy waveform for duration:', duration);
    waveformData = [];

    for (let i = 0; i < 2000; i++) {
        const time = (i / 2000) * duration;
        const frequency = 0.1 + Math.sin(time * 0.1) * 0.05;
        const baseIntensity = 0.3 + Math.sin(time * frequency) * 0.2;
        const variation = Math.random() * 0.3;
        const intensity = Math.max(0, Math.min(1, baseIntensity + variation));

        waveformData.push({
            min: -intensity * 0.8,
            max: intensity
        });
    }

    console.log(`Generated ${waveformData.length} dummy waveform points`);
}

// 캔버스 크기 조정
function resizeWaveformCanvas() {
    const wrapper = document.getElementById('waveform-wrapper');
    const rect = wrapper.getBoundingClientRect();

    waveformCanvas.width = Math.max(rect.width * waveformZoom, rect.width);
    waveformCanvas.height = 120;

    rulerCanvas.width = waveformCanvas.width;
    rulerCanvas.height = 40;
}

// Waveform 그리기 (동적 pre-delay 적용)
function drawWaveform() {
    if (!waveformData || !waveformCanvas || !hasAudioFile)
        return;

    resizeWaveformCanvas();

    const width = waveformCanvas.width;
    const height = waveformCanvas.height;
    const centerY = height / 2;
    const preDelaySeconds = getPreDelaySeconds();
    const totalDuration = MUSIC_START_TIME + audioBuffer.duration + preDelaySeconds; // 전체 지속시간
    const musicStartRatio = MUSIC_START_TIME / totalDuration; // 음악 시작 비율
    const barWidth = width / waveformData.length;

    waveformCtx.clearRect(0, 0, width, height);

    // 게임 시작~음악 시작 구간 (3초)
    const musicStartX = width * musicStartRatio;
    waveformCtx.fillStyle = 'rgba(100, 100, 100, 0.8)';
    waveformCtx.fillRect(0, 0, musicStartX, height);

    // 게임 시작 구간 라벨
    waveformCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    waveformCtx.font = '12px Arial';
    waveformCtx.textAlign = 'center';
    waveformCtx.fillText('게임 시작', musicStartX / 2, height / 2 - 10);
    waveformCtx.fillText('(3초 후 음악 시작)', musicStartX / 2, height / 2 + 5);
    if (preDelaySeconds !== 0) {
        waveformCtx.font = '10px Arial';
        waveformCtx.fillStyle = 'rgba(255, 200, 100, 0.9)';
        waveformCtx.fillText(`Pre-delay: ${preDelaySeconds > 0 ? '+' : ''}${(preDelaySeconds * 1000).toFixed(0)}ms`, musicStartX / 2, height / 2 + 18);
    }

    // 음악 구간의 waveform 그리기
    waveformCtx.fillStyle = '#4CAF50';
    const musicAreaWidth = width * (audioBuffer.duration / totalDuration);
    for (let i = 0; i < waveformData.length; i++) {
        const x = musicStartX + (i * musicAreaWidth / waveformData.length);
        const minHeight = waveformData[i].min * centerY;
        const maxHeight = waveformData[i].max * centerY;

        if (x >= musicStartX && x < width) { // 음악 시작점 이후만 그리기
            // 위쪽 바
            waveformCtx.fillRect(x, centerY - maxHeight, Math.max(1, musicAreaWidth / waveformData.length - 1), maxHeight);
            // 아래쪽 바
            waveformCtx.fillRect(x, centerY, Math.max(1, musicAreaWidth / waveformData.length - 1), -minHeight);
        }
    }

    drawRuler();
}

// 눈금자 그리기 (동적 pre-delay 적용)
function drawRuler() {
    if (!audioBuffer || !hasAudioFile)
        return;

    const width = rulerCanvas.width;
    const height = rulerCanvas.height;
    const preDelaySeconds = getPreDelaySeconds();
    const duration = MUSIC_START_TIME + audioBuffer.duration + preDelaySeconds; // 전체 지속시간

    rulerCtx.clearRect(0, 0, width, height);

    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);

    rulerCtx.strokeStyle = '#666';
    rulerCtx.fillStyle = '#ccc';
    rulerCtx.font = '9px Arial';

    const pixelsPerSecond = width / duration;
    let timeInterval = 1;

    if (pixelsPerSecond < 30)
        timeInterval = 10;
    else if (pixelsPerSecond < 60)
        timeInterval = 5;
    else if (pixelsPerSecond < 120)
        timeInterval = 2;
    else if (pixelsPerSecond > 500)
        timeInterval = 0.1;
    else if (pixelsPerSecond > 250)
        timeInterval = 0.5;

    // 전체 시간 눈금 (0초부터 전체 구간)
    for (let time = 0; time <= duration; time += timeInterval) {
        const x = (time / duration) * width;
        const isSecond = time % 1 === 0;

        rulerCtx.strokeStyle = time < MUSIC_START_TIME ? '#888' : '#666'; // 음악 시작 전은 다른 색상
        rulerCtx.beginPath();
        rulerCtx.moveTo(x, 0);
        rulerCtx.lineTo(x, isSecond ? 15 : 8);
        rulerCtx.stroke();

        if (isSecond && time % Math.max(1, Math.floor(timeInterval)) === 0) {
            rulerCtx.fillStyle = time < MUSIC_START_TIME ? '#aaa' : '#ccc';
            if (time < MUSIC_START_TIME) {
                // 게임 시작부터의 시간 표시 (0s, 1s, 2s)
                rulerCtx.fillText(`${time.toFixed(0)}s`, x + 1, 28);
            } else {
                // 음악 시간으로 표시 (♪0s, ♪1s, ♪2s...)
                const musicTime = time - MUSIC_START_TIME;
                rulerCtx.fillText(`♪${musicTime.toFixed(musicTime < 1 ? 1 : 0)}s`, x + 1, 28);
            }
        }
    }

    // 음악 시작점 마커 (3초 지점)
    const startX = (MUSIC_START_TIME / duration) * width;
    rulerCtx.strokeStyle = '#ff4444';
    rulerCtx.lineWidth = 2;
    rulerCtx.beginPath();
    rulerCtx.moveTo(startX, 0);
    rulerCtx.lineTo(startX, height);
    rulerCtx.stroke();

    rulerCtx.fillStyle = '#ff4444';
    rulerCtx.font = 'bold 10px Arial';
    rulerCtx.fillText('음악 시작', startX + 2, 12);
    rulerCtx.font = '8px Arial';
    rulerCtx.fillText('(3초)', startX + 2, 22);
}

function updateWaveformSlider() {
    const maxScroll = Math.max(0, waveformZoom - 1);
    if (maxScroll === 0) {
        waveformSlider.disabled = true;
        waveformSlider.value = 0;
    } else {
        waveformSlider.disabled = false;
        const value = Math.round((waveformOffset / maxScroll) * 100);
        waveformSlider.value = Math.max(0, Math.min(100, value));
    }
}

// 캔버스 크기 조정
function resizeCanvas() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
}

// 초기 방향 노트 확인
function ensureInitialDirectionNote() {
    if (!notes.find(n => n.beat === 0 && n.type === "direction")) {
        notes.unshift({
            type: "direction",
            beat: 0,
            direction: "none"
        });
    }
}

// 방향을 벡터로 변환
function directionToVector(dir) {
    const map = {
        none: [0, 0],
        up: [0, -1],
        down: [0, 1],
        left: [-1, 0],
        right: [1, 0],
        upleft: [-1, -1],
        upright: [1, -1],
        downleft: [-1, 1],
        downright: [1, 1]
    };
    return map[dir] || [0, 0];
}

// 그리드 그리기
function drawGrid() {
    const gridSize = 8;
    const startX = Math.floor(-viewOffset.x / zoom / gridSize) - 1;
    const endX = Math.ceil((canvas.width - viewOffset.x) / zoom / gridSize) + 1;
    const startY = Math.floor(-viewOffset.y / zoom / gridSize) - 1;
    const endY = Math.ceil((canvas.height - viewOffset.y) / zoom / gridSize) + 1;

    ctx.strokeStyle = "rgba(150, 150, 150, 0.2)";
    ctx.lineWidth = 1;

    for (let i = startX; i <= endX; i++) {
        const x = i * gridSize * zoom + viewOffset.x;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }

    for (let j = startY; j <= endY; j++) {
        const y = j * gridSize * zoom + viewOffset.y;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
}

// 경로 그리기
function drawPath() {
    resizeCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ensureInitialDirectionNote();

    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    drawGrid();

    // direction 노트들을 pre-delay를 고려한 경로상의 위치로 변환
    const directionNotes = notes.filter(n => n.type === "direction").sort((a, b) => a.beat - b.beat);
    const pathDirectionNotes = directionNotes.map((note, index) => {
        let pathBeat;
        if (note.beat === 0 && note.type === "direction") {
            pathBeat = 0; // 시작점은 항상 0
        } else {
            // 0번 노트가 아닌 모든 노트에 pre-delay 적용
            const originalTime = beatToTime(note.beat, bpm, subdivisions);
            const adjustedTime = originalTime + preDelaySeconds;
            pathBeat = timeToBeat(adjustedTime, bpm, subdivisions);
        }
        return {
            ...note,
            pathBeat: pathBeat
        };
    }).sort((a, b) => a.pathBeat - b.pathBeat);

    const nodePositions = [];
    let pos = {
        x: 0,
        y: 0
    };
    nodePositions.push(pos);
    const segmentBeats = [];

    // 경로 그리기 (pathBeat 기준으로)
    ctx.beginPath();
    ctx.moveTo(pos.x * zoom + viewOffset.x, pos.y * zoom + viewOffset.y);

    for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
        const a = pathDirectionNotes[i];
        const b = pathDirectionNotes[i + 1];
        const dBeat = b.pathBeat - a.pathBeat;
        const dist = (8 * dBeat) / subdivisions;
        const [dx, dy] = directionToVector(a.direction);
        const mag = Math.hypot(dx, dy) || 1;
        const next = {
            x: pos.x + (dx / mag) * dist,
            y: pos.y + (dy / mag) * dist
        };
        ctx.lineTo(next.x * zoom + viewOffset.x, next.y * zoom + viewOffset.y);
        segmentBeats.push({
            start: a.pathBeat,
            end: b.pathBeat,
            from: {
                ...pos
            },
            to: {
                ...next
            }
        });
        pos = next;
        nodePositions.push(pos);
    }
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.stroke();

    // 정수 분박 위치에 점 표시 (pathBeat 기준으로)
    const totalPathBeats = pathDirectionNotes[pathDirectionNotes.length - 1]?.pathBeat || 0;
    for (let beat = subdivisions; beat < totalPathBeats; beat += subdivisions) {
        for (let s of segmentBeats) {
            if (s.start <= beat && beat <= s.end) {
                const interp = (beat - s.start) / (s.end - s.start);
                const x = s.from.x + (s.to.x - s.from.x) * interp;
                const y = s.from.y + (s.to.y - s.from.y) * interp;
                ctx.beginPath();
                ctx.arc(x * zoom + viewOffset.x, y * zoom + viewOffset.y, 4, 0, 2 * Math.PI);
                ctx.fillStyle = "rgba(128,128,128,0.4)";
                ctx.fill();
                break;
            }
        }
    }

    // 노트 그리기 (0번 노트 제외하고 모든 노트에 pre-delay 적용)
    notes.forEach((note, index) => {
        if (!note)
            return;
        if (note.beat === 0 && !(index === 0 && note.type === "direction"))
            return;

        let pathBeat;
        if (note.beat === 0 && note.type === "direction") {
            pathBeat = 0; // 시작점은 그대로
        } else {
            // 0번 노트가 아닌 모든 노트(direction, tab 구분 없이)에 pre-delay 적용
            const originalTime = beatToTime(note.beat, bpm, subdivisions);
            const adjustedTime = originalTime + preDelaySeconds;
            pathBeat = timeToBeat(adjustedTime, bpm, subdivisions);
        }

        // pathBeat을 사용해서 노트 위치 계산 (pathDirectionNotes 기준으로)
        let i = 0;
        for (; i < pathDirectionNotes.length - 1; i++) {
            if (pathDirectionNotes[i].pathBeat <= pathBeat && pathBeat <= pathDirectionNotes[i + 1].pathBeat)
                break;
        }
        const a = pathDirectionNotes[i];
        const b = pathDirectionNotes[i + 1];
        const pa = nodePositions[i];
        const pb = nodePositions[i + 1];
        if (!a || !b || !pa || !pb || b.pathBeat === a.pathBeat)
            return;

        const interp = (pathBeat - a.pathBeat) / (b.pathBeat - a.pathBeat);
        const x = pa.x + (pb.x - pa.x) * interp;
        const y = pa.y + (pb.y - pa.y) * interp;
        const screenX = x * zoom + viewOffset.x;
        const screenY = y * zoom + viewOffset.y;

        if (note.type === "tab") {
            ctx.beginPath();
            ctx.arc(screenX, screenY, 5, 0, 2 * Math.PI);

            // 0번 노트가 아닌 경우 보정된 색상으로 표시
            if (note.beat === 0 && note.type === "direction") {
                ctx.fillStyle = "red"; // 기본 색상
            } else {
                ctx.fillStyle = "#FF6B6B"; // 보정된 노트는 밝은 빨간색
            }
            ctx.fill();

            // 보정된 노트에 테두리 추가
            if (!(note.beat === 0 && note.type === "direction")) {
                ctx.strokeStyle = "#4CAF50";
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }

        if (note.type === "direction") {
            const [dx, dy] = directionToVector(note.direction);
            const mag = Math.hypot(dx, dy) || 1;
            const ux = (dx / mag) * 16;
            const uy = (dy / mag) * 16;
            const endX = screenX + ux;
            const endY = screenY + uy;

            ctx.beginPath();
            ctx.moveTo(screenX, screenY);
            ctx.lineTo(endX, endY);

            // 0번 노트가 아닌 경우 보정된 색상으로 표시
            if (note.beat === 0) {
                ctx.strokeStyle = "#f00"; // 기본 빨간색
            } else {
                ctx.strokeStyle = "#4CAF50"; // 보정된 노트는 초록색
            }
            ctx.lineWidth = 2;
            ctx.stroke();

            const perpX = -uy * 0.5;
            const perpY = ux * 0.5;
            ctx.beginPath();
            ctx.moveTo(endX, endY);
            ctx.lineTo(endX - ux * 0.4 + perpX, endY - uy * 0.4 + perpY);
            ctx.lineTo(endX - ux * 0.4 - perpX, endY - uy * 0.4 - perpY);
            ctx.closePath();

            if (note.beat === 0) {
                ctx.fillStyle = "#f00"; // 기본 빨간색
            } else {
                ctx.fillStyle = "#4CAF50"; // 보정된 노트는 초록색
            }
            ctx.fill();
        }
    });

    // 플레이어 그리기 부분도 pathDirectionNotes와 nodePositions 사용하도록 수정
    if (isPlaying && !isNaN(demoPlayer.x) && !isNaN(demoPlayer.y)) {
        const screenX = demoPlayer.x * zoom + viewOffset.x;
        const screenY = demoPlayer.y * zoom + viewOffset.y;

        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.strokeStyle = "blue";
        ctx.fillStyle = "blue";
        ctx.beginPath();
        const spikes = 5;
        const outerRadius = 10;
        const innerRadius = 4;
        for (let i = 0; i < spikes * 2; i++) {
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const angle = (i * Math.PI) / spikes;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // 하이라이트 효과 (0번 노트 제외하고 모든 노트에 pre-delay 적용)
    if (highlightedNoteIndex !== null && highlightedNoteTimer > 0) {
        const note = notes[highlightedNoteIndex];
        let pathBeat;
        if (note.beat === 0 && note.type === "direction") {
            pathBeat = 0; // 시작점은 그대로
        } else {
            // 0번 노트가 아닌 모든 노트에 pre-delay 적용
            const originalTime = beatToTime(note.beat, bpm, subdivisions);
            const adjustedTime = originalTime + preDelaySeconds;
            pathBeat = timeToBeat(adjustedTime, bpm, subdivisions);
        }

        const pos = getNotePositionFromPathData(pathBeat, pathDirectionNotes, nodePositions);
        if (pos) {
            const x = pos.x * zoom + viewOffset.x;
            const y = pos.y * zoom + viewOffset.y;

            const alpha = Math.min(1, highlightedNoteTimer * 2);
            const radius = 15 + (0.5 - highlightedNoteTimer) * 30;

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.strokeStyle = `rgba(255, 200, 0, ${alpha})`;
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    }

    // 경로 강조 효과도 pathDirectionNotes와 nodePositions 사용
    if (pathHighlightTimer > 0) {
        ctx.save();
        ctx.strokeStyle = `rgba(255, 100, 100, ${pathHighlightTimer})`;
        ctx.lineWidth = 4;
        ctx.shadowColor = 'rgba(255, 100, 100, 0.5)';
        ctx.shadowBlur = 10;

        ctx.beginPath();
        let pos = {
            x: 0,
            y: 0
        };
        ctx.moveTo(pos.x * zoom + viewOffset.x, pos.y * zoom + viewOffset.y);

        for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
            const a = pathDirectionNotes[i];
            const b = pathDirectionNotes[i + 1];
            const dBeat = b.pathBeat - a.pathBeat;
            const dist = (8 * dBeat) / subdivisions;
            const [dx, dy] = directionToVector(a.direction);
            const mag = Math.hypot(dx, dy) || 1;
            const next = {
                x: pos.x + (dx / mag) * dist,
                y: pos.y + (dy / mag) * dist
            };
            ctx.lineTo(next.x * zoom + viewOffset.x, next.y * zoom + viewOffset.y);
            pos = next;
        }
        ctx.stroke();
        ctx.restore();
    }
}

// 로컬 스토리지 저장/로드 (오디오 파일 정보 포함)
function saveToStorage() {
    const preDelayValue = parseInt(document.getElementById("pre-delay").value || 0);
    const adjustedPreDelay = isMacOS() ? preDelayValue - MAC_DELAY_OFFSET : preDelayValue;

    const saveData = {
        notes: notes,
        audioFileName: savedAudioFile ? savedAudioFile.name : null,
        audioFileSize: savedAudioFile ? savedAudioFile.size : null,
        audioFileType: savedAudioFile ? savedAudioFile.type : null,
        preDelay: adjustedPreDelay // Mac OS에서는 -800 적용
    };
    localStorage.setItem("autosave_notes", JSON.stringify(saveData));
}

function loadFromStorage() {
    const saved = localStorage.getItem("autosave_notes");
    if (saved) {
        try {
            const parsed = JSON.parse(saved);

            // 이전 버전 호환성 (notes가 배열인 경우)
            if (Array.isArray(parsed)) {
                notes.splice(0, notes.length, ...parsed);
            } else if (parsed.notes && Array.isArray(parsed.notes)) {
                notes.splice(0, notes.length, ...parsed.notes);

                // Pre-delay 설정 복원 (Mac OS에서는 +800 적용)
                if (parsed.preDelay !== undefined) {
                    const adjustedPreDelay = isMacOS() ? parsed.preDelay + MAC_DELAY_OFFSET : parsed.preDelay;
                    document.getElementById("pre-delay").value = adjustedPreDelay;
                }

                // 오디오 파일 정보 복원
                if (parsed.audioFileName) {
                    savedAudioFile = {
                        name: parsed.audioFileName,
                        size: parsed.audioFileSize || 0,
                        type: parsed.audioFileType || 'audio/*'
                    };

                    // 파일 입력 요소에 표시할 텍스트 설정
                    setTimeout(() => {
                        const fileInput = document.getElementById("audio-file");
                        const container = fileInput.parentElement;
                        let indicator = container.querySelector('.file-indicator');
                        if (!indicator) {
                            indicator = document.createElement('div');
                            indicator.className = 'file-indicator';
                            indicator.style.cssText = 'margin-top: 5px; font-size: 12px; color: #666; font-style: italic;';
                            container.appendChild(indicator);
                        }
                        indicator.textContent = `이전 파일: ${parsed.audioFileName} (다시 선택 필요)`;
                    }, 100);
                }
            }
        } catch (e) {
            console.error("불러오기 실패:", e);
        }
    }
}

// 노트 위치 계산
function getNotePosition(beat) {
    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    // beat를 pathBeat으로 변환 (direction 노트는 원본 beat, tab 노트만 pre-delay 적용)
    // 이 함수는 일반적으로 beat 값으로 호출되므로, beat 값 그대로 사용
    let pathBeat = beat;

    const directionNotes = notes.filter(n => n.type === "direction").sort((a, b) => a.beat - b.beat);
    const pathDirectionNotes = directionNotes.map((note, index) => {
        let noteBeat;
        if (note.beat === 0 && note.type === "direction") {
            noteBeat = 0; // 시작점은 항상 0
        } else {
            // 0번 노트가 아닌 모든 노트에 pre-delay 적용
            const originalTime = beatToTime(note.beat, bpm, subdivisions);
            const adjustedTime = originalTime + preDelaySeconds;
            noteBeat = timeToBeat(adjustedTime, bpm, subdivisions);
        }
        return {
            ...note,
            pathBeat: noteBeat
        };
    }).sort((a, b) => a.pathBeat - b.pathBeat);

    let pos = {
        x: 0,
        y: 0
    };
    const nodePositions = [pos];

    for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
        const a = pathDirectionNotes[i];
        const b = pathDirectionNotes[i + 1];
        const dBeat = b.pathBeat - a.pathBeat;
        const dist = (8 * dBeat) / subdivisions;
        const [dx, dy] = directionToVector(a.direction);
        const mag = Math.hypot(dx, dy) || 1;
        const next = {
            x: pos.x + (dx / mag) * dist,
            y: pos.y + (dy / mag) * dist
        };
        if (a.pathBeat <= pathBeat && pathBeat <= b.pathBeat) {
            const interp = (pathBeat - a.pathBeat) / (b.pathBeat - a.pathBeat);
            return {
                x: pos.x + (next.x - pos.x) * interp,
                y: pos.y + (next.y - pos.y) * interp
            };
        }
        pos = next;
        nodePositions.push(pos);
    }
    return null;
}

// 노트 포커스
function focusNoteAtIndex(index) {
    const note = notes[index];
    if (!note)
        return;

    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    // 수정: pre-delay를 고려한 실제 경로상의 비트 위치로 포커스
    let pathBeat;
    if (note.beat === 0 && note.type === "direction") {
        pathBeat = 0;
    } else {
        const adjustedTime = beatToTime(note.beat, bpm, subdivisions) - preDelaySeconds;
        pathBeat = timeToBeat(adjustedTime, bpm, subdivisions);
    }

    const pos = getNotePosition(pathBeat); // pathBeat 사용
    if (!pos)
        return;

    viewOffset.x = canvas.width / 2 - pos.x * zoom;
    viewOffset.y = canvas.height / 2 - pos.y * zoom;

    drawPath();

    const rows = document.querySelectorAll("#note-list .note-row, #note-list tr");
    rows.forEach(r => r.classList.remove("highlight"));
    if (rows[index]) {
        rows[index].classList.add("highlight");
        rows[index].scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }

    highlightedNoteIndex = index;
    highlightedNoteTimer = 0.5;

    if (!isDrawLoopRunning) {
        isDrawLoopRunning = true;
        drawLoop();
    }
}

// 애니메이션 루프
function drawLoop() {
    if (highlightedNoteTimer > 0) {
        highlightedNoteTimer -= 1 / 60;
        if (highlightedNoteTimer <= 0) {
            highlightedNoteIndex = null;
            highlightedNoteTimer = 0;
        }
        drawPath();
    }

    if (pathHighlightTimer > 0) {
        pathHighlightTimer -= 1 / 60;
        if (pathHighlightTimer <= 0) {
            pathHighlightTimer = 0;
        }
        drawPath();
    }

    if (highlightedNoteTimer > 0 || pathHighlightTimer > 0) {
        globalAnimationFrameId = requestAnimationFrame(drawLoop);
    } else {
        isDrawLoopRunning = false;
    }
}

// 노트 리스트 렌더링
function renderNoteList() {
    const tbody = document.getElementById("note-list");
    tbody.innerHTML = "";

    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    notes.forEach((note, index) => {
        const tr = document.createElement("tr");
        tr.className = note.type === "direction" ? "dir-note" : "tab-note";

        const tdIndex = document.createElement("td");
        tdIndex.textContent = index;

        const tdType = document.createElement("td");
        tdType.textContent = note.type;

        const tdBeat = document.createElement("td");
        const inputBeat = document.createElement("input");
        inputBeat.type = "number";
        inputBeat.step = "1";
        inputBeat.value = note.beat;
        inputBeat.addEventListener("change", () => {
            note.beat = parseInt(inputBeat.value);
            saveToStorage();
            drawPath();
            renderNoteList();
            if (waveformData)
                drawWaveform();
        });
        tdBeat.appendChild(inputBeat);

        const tdTime = document.createElement("td");
        const originalTime = beatToTime(note.beat, bpm, subdivisions);

        // 0번 direction 노트는 보정하지 않음
        if (note.beat === 0 && note.type === "direction") {
            tdTime.textContent = `${originalTime.toFixed(3)}s`;
            tdTime.style.color = '#666';
            tdTime.title = '게임 시작점';
        } else {
            // 수정: 원본시간 + pre-delay만 (MUSIC_START_TIME 제거)
            const finalTime = originalTime + preDelaySeconds;
            tdTime.innerHTML = `
        <div style="color: #4CAF50; font-weight: bold;">${finalTime.toFixed(3)}s</div>
        <div style="font-size: 11px; color: #999;">원본: ${originalTime.toFixed(3)}s</div>
    `;
            tdTime.title = `원본: ${originalTime.toFixed(3)}s → 최종: ${finalTime.toFixed(3)}s (pre-delay: ${preDelaySeconds > 0 ? '+' : ''}${preDelaySeconds.toFixed(3)}s)`;
        }

        const tdDir = document.createElement("td");
        if (note.type === "direction") {
            const select = document.createElement("select");
            ["none", "up", "down", "left", "right", "upleft", "upright", "downleft", "downright"].forEach(d => {
                const opt = document.createElement("option");
                opt.value = d;
                opt.textContent = d;
                if (note.direction === d)
                    opt.selected = true;
                select.appendChild(opt);
            });
            select.addEventListener("change", () => {
                note.direction = select.value;
                saveToStorage();
                drawPath();
                if (waveformData)
                    drawWaveform();
            });
            tdDir.appendChild(select);
        } else {
            tdDir.textContent = "-";
        }

        const tdDelete = document.createElement("td");
        const btn = document.createElement("button");
        btn.textContent = "삭제";
        btn.disabled = (note.beat === 0 && note.type === "direction" && index === 0);
        btn.addEventListener("click", () => {
            notes.splice(index, 1);
            saveToStorage();
            drawPath();
            renderNoteList();
            if (waveformData)
                drawWaveform();
        });
        tdDelete.appendChild(btn);

        tr.append(tdIndex, tdType, tdBeat, tdTime, tdDir, tdDelete);
        tr.addEventListener("click", (e) => {
            if (["INPUT", "SELECT", "BUTTON"].includes(e.target.tagName))
                return;
            focusNoteAtIndex(index);
        });
        tbody.appendChild(tr);
    });
}

// 오디오 파일 처리 (hasAudioFile 플래그 설정)
function processAudioForWaveform(audioFile) {
    console.log('Processing audio file:', audioFile.name);

    hasAudioFile = true; // 오디오 파일 로드됨 표시
    savedAudioFile = audioFile; // 파일 정보 저장

    // Web Audio API 시도
    try {
        const audioContext = new(window.AudioContext || window.webkitAudioContext)();
        const reader = new FileReader();

        reader.onload = function (e) {
            audioContext.decodeAudioData(e.target.result)
            .then(buffer => {
                console.log('AudioContext decoding successful');
                audioBuffer = buffer;
                generateWaveformData(buffer);
                drawWaveform();
                saveToStorage(); // 오디오 파일 정보 저장
            })
            .catch(err => {
                console.warn('AudioContext decoding failed:', err);
                tryAudioElementMethod(audioFile);
            });
        };

        reader.onerror = function () {
            console.warn('FileReader failed');
            tryAudioElementMethod(audioFile);
        };

        reader.readAsArrayBuffer(audioFile);
    } catch (error) {
        console.warn('AudioContext not supported:', error);
        tryAudioElementMethod(audioFile);
    }
}

function tryAudioElementMethod(audioFile) {
    console.log('Trying Audio element method');
    const audio = new Audio();
    const url = URL.createObjectURL(audioFile);
    audio.src = url;

    audio.addEventListener('loadedmetadata', () => {
        console.log('Audio metadata loaded, duration:', audio.duration);
        audioBuffer = {
            duration: audio.duration
        };
        generateDummyWaveform(audio.duration);
        drawWaveform();
        saveToStorage(); // 오디오 파일 정보 저장
        URL.revokeObjectURL(url);
    });

    audio.addEventListener('error', () => {
        console.error('Audio element failed');
        hasAudioFile = false; // 실패 시 플래그 해제
        savedAudioFile = null;
        audioBuffer = null;
        waveformData = null;
        drawWaveform(); // 빈 waveform 그리기
        URL.revokeObjectURL(url);
    });

    setTimeout(() => {
        if (!audioBuffer || audioBuffer.duration === undefined) {
            console.warn('Audio loading timeout, clearing waveform');
            hasAudioFile = false;
            savedAudioFile = null;
            audioBuffer = null;
            waveformData = null;
            drawWaveform();
        }
    }, 5000);
}

function generateWaveformData(buffer) {
    if (!buffer || !buffer.getChannelData) {
        console.error('Invalid audio buffer');
        return;
    }

    try {
        const channelData = buffer.getChannelData(0);
        const samples = channelData.length;
        const blockSize = Math.max(1, Math.floor(samples / 2000));

        waveformData = [];
        for (let i = 0; i < samples; i += blockSize) {
            let min = 0;
            let max = 0;

            for (let j = 0; j < blockSize && i + j < samples; j++) {
                const sample = channelData[i + j];
                if (sample > max)
                    max = sample;
                if (sample < min)
                    min = sample;
            }

            waveformData.push({
                min,
                max
            });
        }

        console.log(`Generated ${waveformData.length} waveform data points`);
    } catch (error) {
        console.error('Error generating waveform data:', error);
        waveformData = [];
        for (let i = 0; i < 2000; i++) {
            const intensity = Math.random() * 0.5;
            waveformData.push({
                min: -intensity,
                max: intensity
            });
        }
    }
}

// waveform 클릭 핸들링 (동적 pre-delay 적용)
function setupWaveformClick() {
    waveformCanvas.addEventListener('click', (e) => {
        if (!audioBuffer || !waveformData || !hasAudioFile) {
            alert('먼저 오디오 파일을 선택해주세요.');
            return;
        }

        const rect = waveformCanvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const wrapper = document.getElementById('waveform-wrapper');
        const scrollLeft = Math.abs(parseFloat(waveformCanvas.style.left || '0'));
        const actualClickX = clickX + scrollLeft;
        const canvasWidth = waveformCanvas.width;

        const preDelaySeconds = getPreDelaySeconds();
        const totalDuration = audioBuffer.duration + preDelaySeconds; // 전체 시간
        const clickTime = (actualClickX / canvasWidth) * totalDuration;

        // Pre-delay 이전 클릭은 무시
        if (clickTime < preDelaySeconds) {
            alert(`음악 시작 전 구간입니다. ${preDelaySeconds}초 이후 구간을 클릭해주세요.`);
            return;
        }

        const bpm = parseFloat(document.getElementById("bpm").value || 120);
        const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
        const clickBeat = timeToBeat(clickTime, bpm, subdivisions);

        const pos = getNotePosition(clickBeat);
        if (!pos) {
            alert('해당 시간에 경로가 만들어지지 않았습니다. 더 많은 direction 노트를 추가해주세요.');
            return;
        }

        viewOffset.x = canvas.width / 2 - pos.x * zoom;
        viewOffset.y = canvas.height / 2 - pos.y * zoom;

        pathHighlightTimer = 1.0;

        drawPath();

        if (!isDrawLoopRunning) {
            isDrawLoopRunning = true;
            drawLoop();
        }
    });
}

// waveform 휠 이벤트
function setupWaveformWheel() {
    waveformCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();

        const rect = waveformCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const canvasWidth = waveformCanvas.width;

        const zoomFactor = e.deltaY < 0 ? 1.2 : 0.8;
        const newZoom = Math.max(0.25, Math.min(16, waveformZoom * zoomFactor));

        if (newZoom !== waveformZoom) {
            const mouseRatio = mouseX / canvasWidth;
            waveformOffset = mouseRatio * (newZoom - waveformZoom);

            waveformZoom = newZoom;
            document.getElementById('waveform-zoom-level').textContent = Math.round(waveformZoom * 100) + '%';

            drawWaveform();
            updateWaveformSlider();
        }
    }, {
        passive: false
    });
}

// waveform 슬라이더
function setupWaveformSlider() {
    waveformSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        const maxScroll = Math.max(0, waveformZoom - 1);
        waveformOffset = (value / 100) * maxScroll;

        updateWaveformPosition();
    });
}

function updateWaveformPosition() {
    const wrapper = document.getElementById('waveform-wrapper');
    if (!wrapper)
        return;

    const wrapperWidth = wrapper.offsetWidth;
    const canvasWidth = waveformCanvas.width;

    const maxOffset = Math.max(0, canvasWidth - wrapperWidth);
    const scrollLeft = (waveformOffset / Math.max(waveformZoom - 1, 1)) * maxOffset;

    const leftPos = -scrollLeft + 'px';

    if (waveformCanvas.style.left !== leftPos) {
        waveformCanvas.style.left = leftPos;
        rulerCanvas.style.left = leftPos;
    }
}

// waveform 진행률 업데이트
function updateWaveformProgress() {
    if (!audioBuffer || !isPlaying)
        return;

    const preDelaySeconds = getPreDelaySeconds();
    const duration = MUSIC_START_TIME + audioBuffer.duration;
    const progressPercent = Math.min(elapsedTime / duration, 1);
    const canvasWidth = waveformCanvas.width;
    const wrapper = document.getElementById('waveform-wrapper');
    const scrollLeft = parseFloat(waveformCanvas.style.left || '0');

    const progressX = (progressPercent * canvasWidth) + scrollLeft;
    waveformProgress.style.left = Math.max(0, progressX) + 'px';
}

// 데모 재생 함수들
function startDemo() {
    isPlaying = true;
    isPaused = false;
    elapsedTime = 0;
    startTime = performance.now();

    // 재생된 노트 리셋
    resetPlayedNotes();

    updateDemo();

    setTimeout(() => {
        if (!isPaused) {
            demoAudio.currentTime = 0;
            demoAudio.play();
        }
    }, MUSIC_START_TIME * 1000);
}

function updateDemo() {
    if (!isPlaying || isPaused)
        return;

    elapsedTime = (performance.now() - startTime) / 1000;
    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    // 수정: pre-delay를 빼서 실제 경로상의 위치 계산
    const currentBeat = timeToBeat(elapsedTime, bpm, subdivisions);
    const audioTime = Math.max(0, elapsedTime - MUSIC_START_TIME);

    // 노트 히트 체크
    checkNoteHits(elapsedTime);

    if (!isNaN(demoAudio.duration)) {
        const totalTime = demoAudio.duration + preDelaySeconds;
        spanDemoTime.textContent = `${formatTime(elapsedTime)} / ${formatTime(totalTime)}`;
        seekbar.max = Math.round(totalTime * 1000);
        seekbar.value = Math.round(elapsedTime * 1000);
    }

    if (elapsedTime >= MUSIC_START_TIME) {
        demoAudio.play();
    }

    updateDemoPlayerPosition(currentBeat);

    drawPath();
    updateWaveformProgress();

    if (highlightedNoteTimer > 0) {
        highlightedNoteTimer -= 1 / 60;
        if (highlightedNoteTimer <= 0) {
            highlightedNoteTimer = 0;
            highlightedNoteIndex = null;
        }
    }

    animationFrameId = requestAnimationFrame(updateDemo);
}

function getNotePositionFromPathData(pathBeat, pathDirectionNotes, nodePositions) {
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);

    for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
        const a = pathDirectionNotes[i];
        const b = pathDirectionNotes[i + 1];
        const pa = nodePositions[i];
        const pb = nodePositions[i + 1];

        if (a.pathBeat <= pathBeat && pathBeat <= b.pathBeat) {
            const interp = (pathBeat - a.pathBeat) / (b.pathBeat - a.pathBeat);
            return {
                x: pa.x + (pb.x - pa.x) * interp,
                y: pa.y + (pb.y - pa.y) * interp
            };
        }
    }
    return null;
}

function updateDemoPlayerPosition(currentBeat) {
    const bpm = parseFloat(document.getElementById("bpm").value || 120);
    const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
    const preDelaySeconds = getPreDelaySeconds();

    const directionNotes = notes.filter(n => n.type === "direction").sort((a, b) => a.beat - b.beat);

    // pathBeat 기준으로 direction 노트들 변환 (경로 생성과 동일한 로직)
    const pathDirectionNotes = directionNotes.map((note, index) => {
        let pathBeat;
        if (note.beat === 0 && note.type === "direction") {
            pathBeat = 0; // 시작점은 항상 0
        } else {
            // 0번 노트가 아닌 모든 노트에 pre-delay 적용
            const originalTime = beatToTime(note.beat, bpm, subdivisions);
            const adjustedTime = originalTime + preDelaySeconds;
            pathBeat = timeToBeat(adjustedTime, bpm, subdivisions);
        }
        return {
            ...note,
            pathBeat: pathBeat
        };
    }).sort((a, b) => a.pathBeat - b.pathBeat);

    // 경로 계산 (pathBeat 기준)
    const nodePositions = [];
    let pos = {
        x: 0,
        y: 0
    };
    nodePositions.push(pos);
    for (let i = 0; i < pathDirectionNotes.length - 1; i++) {
        const a = pathDirectionNotes[i];
        const b = pathDirectionNotes[i + 1];
        const dBeat = b.pathBeat - a.pathBeat;
        const dist = (8 * dBeat) / subdivisions;
        const [dx, dy] = directionToVector(a.direction);
        const mag = Math.hypot(dx, dy) || 1;
        const next = {
            x: pos.x + (dx / mag) * dist,
            y: pos.y + (dy / mag) * dist
        };
        pos = next;
        nodePositions.push(pos);
    }

    // 플레이어 위치 보간 (currentBeat을 그대로 사용 - pre-delay가 이미 경로에 반영됨)
    if (pathDirectionNotes.length >= 2) {
        for (let i = 1; i < pathDirectionNotes.length; i++) {
            const a = pathDirectionNotes[i - 1];
            const b = pathDirectionNotes[i];
            const pa = nodePositions[i - 1];
            const pb = nodePositions[i];

            if (currentBeat >= a.pathBeat && currentBeat <= b.pathBeat) {
                const t = (currentBeat - a.pathBeat) / (b.pathBeat - a.pathBeat);
                demoPlayer.x = pa.x + (pb.x - pa.x) * t;
                demoPlayer.y = pa.y + (pb.y - pa.y) * t;
                break;
            }
        }
    }
}

// 시간 포맷팅
function formatTime(sec) {
    const min = Math.floor(sec / 60);
    const secRemain = Math.floor(sec % 60);
    const ms = Math.floor((sec * 1000) % 1000 / 10);
    return `${String(min).padStart(2, '0')}:${String(secRemain).padStart(2, '0')}:${String(ms).padStart(2, '0')}`;
}

// 초기화
document.addEventListener("DOMContentLoaded", () => {
    console.log('DOM loaded, initializing...');

    setupSubdivisionsOptions();

    // 초기 viewOffset 설정
    viewOffset = {
        x: canvas.clientWidth / 2,
        y: canvas.clientHeight / 2
    };

    // 플로팅 기능 설정
    setupWaveformFloating();
    setupWaveformControls();
    setupWaveformWheel();
    setupWaveformSlider();
    setupWaveformClick();

    // 초기 상태에서는 waveform 숨김
    hasAudioFile = false;
    audioBuffer = null;
    waveformData = null;

    // 이전 값 초기화 (BPM/Subdivisions 변경 감지용)
    const bpmField = document.getElementById("bpm");
    const subdivisionsField = document.getElementById("subdivisions");
    const preDelayField = document.getElementById("pre-delay");

    if (bpmField) {
        bpmField.dataset.previousValue = bpmField.value || "120";
    }
    if (subdivisionsField) {
        subdivisionsField.dataset.previousValue = subdivisionsField.value || "16";
    }

    // 이벤트 리스너 설정 (시간 기반 업데이트)
    if (bpmField) {
        bpmField.addEventListener("change", (e) => {
            const newBpm = parseFloat(e.target.value || 120);
            handleBpmChange(newBpm);
        });
    }

    if (subdivisionsField) {
        subdivisionsField.addEventListener("change", (e) => {
            const newSubdivisions = parseInt(e.target.value || 16);
            handleSubdivisionsChange(newSubdivisions);
        });
    }

    if (preDelayField) {
        preDelayField.addEventListener("change", handlePreDelayChange);
    }

    document.getElementById("clear-notes").addEventListener("click", () => {
        if (confirm("모든 데이터를 삭제하시겠습니까?")) {
            localStorage.removeItem("autosave_notes");
            notes.length = 0;
            ensureInitialDirectionNote();
            drawPath();
            renderNoteList();
        }
    });

    document.getElementById("add-tab").addEventListener("click", () => {
        const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
        const maxBeat = Math.max(0, ...notes.map(n => n.beat));
        notes.push({
            type: "tab",
            beat: maxBeat + subdivisions
        });
        saveToStorage();
        drawPath();
        renderNoteList();
        if (waveformData)
            drawWaveform();
    });

    document.getElementById("add-dir").addEventListener("click", () => {
        const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
        const dirs = notes.filter(n => n.type === "direction");
        const maxDir = dirs[dirs.length - 1];
        const newBeat = (maxDir?.beat ?? 0) + subdivisions;
        const inherited = maxDir?.direction ?? "none";
        notes.push({
            type: "direction",
            beat: newBeat,
            direction: inherited
        });
        saveToStorage();
        drawPath();
        renderNoteList();
        if (waveformData)
            drawWaveform();
    });

    // 정렬 버튼
    document.getElementById("sort-notes").addEventListener("click", () => {
        notes.sort((a, b) => a.beat - b.beat);
        saveToStorage();
        drawPath();
        renderNoteList();
    });

    // JSON 저장/로드
    document.getElementById("save-json").addEventListener("click", () => {
        const bpm = parseFloat(document.getElementById("bpm").value || 120);
        const subdivisions = parseInt(document.getElementById("subdivisions").value || 16);
        const preDelayValue = parseInt(document.getElementById("pre-delay").value || 0);

        // Mac OS에서는 Windows 기준으로 변환하여 저장
        const windowsPreDelay = isMacOS() ? preDelayValue - MAC_DELAY_OFFSET : preDelayValue;
        const preDelaySeconds = windowsPreDelay / 1000;

        const exportData = {
            diffIndex: 5,
            level: 10,
            bpm: bpm,
            subdivisions: subdivisions,
            preDelay: windowsPreDelay,
            noteList: notes.map(n => {
                const originalTime = beatToTime(n.beat, bpm, subdivisions);

                // 0번 direction 노트는 보정하지 않음
                let finalTime;
                if (n.beat === 0 && n.type === "direction") {
                    finalTime = originalTime; // 게임 시작점
                } else {
                    // 수정: 원본시간 + pre-delay만 (MUSIC_START_TIME 제거)
                    finalTime = originalTime + preDelaySeconds;
                }

                return {
                    beat: n.beat,
                    originalTime: originalTime, // BPM 기준 원본 시간
                    musicTime: MUSIC_START_TIME + originalTime, // 음악 시작 후 시간
                    finalTime: finalTime, // 최종 노트 타이밍
                    isLong: false,
                    longTime: 0.0,
                    noteType: n.type === "direction" ? "Direction" : "Tab",
                    direction: n.direction || "none"
                };
            }),
            metadata: {
                description: "Music starts at 3 seconds, with pre-delay correction",
                timingExplanation: "finalTime = 3.0 + originalTime + preDelay (except for beat 0 direction note)",
                exportedAt: new Date().toISOString()
            }
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: "application/json"
        });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = "chart_3s_music_start.json";
        a.click();

        URL.revokeObjectURL(url);
    });

    document.getElementById("load-json").addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (!file)
                return;

            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const json = JSON.parse(ev.target.result);
                    if (!json.noteList || !Array.isArray(json.noteList)) {
                        alert("올바른 JSON 파일이 아닙니다.");
                        return;
                    }

                    notes.length = 0;
                    const bpm = json.bpm || 120;
                    const subdivisions = json.subdivisions || 16;
                    const windowsPreDelay = json.preDelay || 3000;

                    // Mac OS에서는 Windows 기준 데이터를 Mac 기준으로 변환
                    const macPreDelay = isMacOS() ? windowsPreDelay + MAC_DELAY_OFFSET : windowsPreDelay;

                    json.noteList.forEach(n => {
                        const beat = n.beat !== undefined ? n.beat : timeToBeat(n.time || 0, bpm, subdivisions);
                        notes.push({
                            type: n.noteType === "Direction" ? "direction" : "tab",
                            beat: beat,
                            direction: n.direction || "none"
                        });
                    });

                    document.getElementById("bpm").value = bpm;
                    document.getElementById("subdivisions").value = subdivisions;
                    document.getElementById("pre-delay").value = macPreDelay;

                    // 이전 값 업데이트
                    document.getElementById("bpm").dataset.previousValue = bpm;
                    document.getElementById("subdivisions").dataset.previousValue = subdivisions;

                    saveToStorage();
                    drawPath();
                    renderNoteList();
                    if (waveformData)
                        drawWaveform();
                } catch (err) {
                    alert("불러오기 중 오류 발생: " + err.message);
                }
            };
            reader.readAsText(file);
        });
        input.click();
    });

    // 오디오 파일 선택
    inputAudio.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) {
            // 파일이 선택 해제된 경우
            hasAudioFile = false;
            audioBuffer = null;
            waveformData = null;
            savedAudioFile = null;
            if (audioFileURL)
                URL.revokeObjectURL(audioFileURL);
            audioFileURL = null;
            demoAudio.src = '';
            drawWaveform(); // 빈 waveform

            // 파일 표시 제거
            const container = inputAudio.parentElement;
            const indicator = container.querySelector('.file-indicator');
            if (indicator)
                indicator.remove();

            saveToStorage();
            return;
        }

        if (audioFileURL)
            URL.revokeObjectURL(audioFileURL);
        audioFileURL = URL.createObjectURL(file);
        demoAudio.src = audioFileURL;
        demoAudio.volume = musicVolume; // 음악 볼륨 적용
        demoAudio.load();

        // 파일 표시 업데이트
        const container = inputAudio.parentElement;
        let indicator = container.querySelector('.file-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'file-indicator';
            indicator.style.cssText = 'margin-top: 5px; font-size: 12px; color: #4CAF50; font-weight: bold;';
            container.appendChild(indicator);
        }
        indicator.textContent = `선택된 파일: ${file.name}`;

        // 음향 그래프 처리
        processAudioForWaveform(file);
    });

    // 재생 제어
    btnDemoPlay.addEventListener("click", () => {
        if (!audioFileURL)
            return;

        if (isPaused) {
            isPaused = false;
            startTime = performance.now() - elapsedTime * 1000;
            const preDelaySeconds = getPreDelaySeconds();
            demoAudio.currentTime = Math.max(0, elapsedTime - preDelaySeconds);
            demoAudio.play();
            updateDemo();
        } else if (!isPlaying) {
            startDemo();
        }
    });

    btnDemoPause.addEventListener("click", () => {
        if (!isPlaying)
            return;
        isPaused = !isPaused;
        if (isPaused) {
            demoAudio.pause();
            cancelAnimationFrame(animationFrameId);
        } else {
            startTime = performance.now() - elapsedTime * 1000;
            demoAudio.play();
            updateDemo();
        }
    });

    btnDemoStop.addEventListener("click", () => {
        if (!isPlaying)
            return;
        isPlaying = false;
        isPaused = false;
        elapsedTime = 0;
        demoAudio.pause();
        demoAudio.currentTime = 0;
        cancelAnimationFrame(animationFrameId);
        spanDemoTime.textContent = "00:00:00 / 00:00:00";
        seekbar.value = 0;
        demoPlayer.x = 0;
        demoPlayer.y = 0;

        // 재생된 노트 리셋
        resetPlayedNotes();

        waveformProgress.style.left = '0px';

        drawPath();
    });

    // 시크바
    seekbar.addEventListener("input", () => {
        if (!isPlaying)
            return;
        elapsedTime = seekbar.value / 1000;
        startTime = performance.now() - elapsedTime * 1000;

        // 시크 시 재생된 노트 리셋
        resetPlayedNotes();

        const preDelaySeconds = getPreDelaySeconds();
        if (elapsedTime < MUSIC_START_TIME) {
            demoAudio.pause();
            demoAudio.currentTime = 0;
        } else {
            demoAudio.currentTime = Math.max(0, elapsedTime - MUSIC_START_TIME);
            if (!demoAudio.paused) {
                demoAudio.play();
            }
        }
        drawPath();
    });

    // 캔버스 이벤트
    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 1.1 : 0.9;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const worldX = (mouseX - viewOffset.x) / zoom;
        const worldY = (mouseY - viewOffset.y) / zoom;
        zoom *= delta;
        viewOffset.x = mouseX - worldX * zoom;
        viewOffset.y = mouseY - worldY * zoom;
        drawPath();
    }, {
        passive: false
    });

    canvas.addEventListener("mousedown", (e) => {
        if (e.button === 1) {
            isPanning = true;
            lastMousePos = {
                x: e.clientX,
                y: e.clientY
            };
        }
    });

    canvas.addEventListener("mousemove", (e) => {
        if (isPanning) {
            const dx = e.clientX - lastMousePos.x;
            const dy = e.clientY - lastMousePos.y;
            viewOffset.x += dx;
            viewOffset.y += dy;
            lastMousePos = {
                x: e.clientX,
                y: e.clientY
            };
            drawPath();
        }
    });

    canvas.addEventListener("mouseup", (e) => {
        if (e.button === 1) {
            isPanning = false;
        }
    });

    canvas.addEventListener("click", (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        for (let i = 0; i < notes.length; i++) {
            const pos = getNotePosition(notes[i].beat);
            if (!pos)
                continue;
            const screenX = pos.x * zoom + viewOffset.x;
            const screenY = pos.y * zoom + viewOffset.y;
            const dist = Math.hypot(screenX - mx, screenY - my);
            if (dist < 10) {
                focusNoteAtIndex(i);
                break;
            }
        }
    });

    function setupSubdivisionsOptions() {
        const subdivisionsSelect = document.getElementById("subdivisions");
        if (!subdivisionsSelect) {
            console.warn("subdivisions select element not found");
            return;
        }

        // 기존 옵션들 제거 (중복 방지)
        subdivisionsSelect.innerHTML = '';

        // 사용 가능한 subdivisions 값들 (2, 12, 16, 24 포함)
        const subdivisionsOptions = [{
                value: 2,
                label: "2"
            }, {
                value: 4,
                label: "4"
            }, {
                value: 8,
                label: "8"
            }, {
                value: 12,
                label: "12"
            }, {
                value: 16,
                label: "16"
            }, {
                value: 24,
                label: "24"
            }, {
                value: 32,
                label: "32"
            }
        ];

        // 옵션들 추가
        subdivisionsOptions.forEach(option => {
            const optionElement = document.createElement("option");
            optionElement.value = option.value;
            optionElement.textContent = option.label;
            subdivisionsSelect.appendChild(optionElement);
        });

        // 기본값 설정 (16으로 설정)
        subdivisionsSelect.value = "16";
        subdivisionsSelect.dataset.previousValue = "16";
    }

    // 토글 기능 설정 (DOMContentLoaded 이벤트 리스너 안에 추가)
    // 토글 기능 설정 (기존 함수 교체)
    function setupToggleFeatures() {
        const sidebar = document.getElementById('sidebar');
        const sidebarToggle = document.getElementById('sidebar-toggle');
        const controlBar = document.getElementById('control-bar');
        const controlBarToggle = document.getElementById('control-bar-toggle');
        const main = document.getElementById('main');
        const waveformContainer = document.getElementById('waveform-container');
        const waveformTriggerZone = document.querySelector('.waveform-trigger-zone');

        // 사이드바 토글
        sidebarToggle.addEventListener('click', () => {
            const isHidden = sidebar.classList.contains('hidden');

            if (isHidden) {
                // 보이기
                sidebar.classList.remove('hidden');
                sidebarToggle.classList.remove('hidden');
                main.classList.remove('sidebar-hidden');
                waveformContainer.classList.remove('sidebar-hidden');
                waveformTriggerZone.classList.remove('sidebar-hidden');
                sidebarToggle.textContent = '◀';
            } else {
                // 숨기기
                sidebar.classList.add('hidden');
                sidebarToggle.classList.add('hidden');
                main.classList.add('sidebar-hidden');
                waveformContainer.classList.add('sidebar-hidden');
                waveformTriggerZone.classList.add('sidebar-hidden');
                sidebarToggle.textContent = '▶';
            }

            // 캔버스 크기 재조정
            setTimeout(() => {
                resizeCanvas();
                if (waveformData) {
                    resizeWaveformCanvas();
                    drawWaveform();
                }
                drawPath();
            }, 300); // 애니메이션 완료 후
        });

        // 컨트롤바 토글
        controlBarToggle.addEventListener('click', () => {
            const isHidden = controlBar.classList.contains('hidden');

            if (isHidden) {
                // 보이기
                controlBar.classList.remove('hidden');
                controlBarToggle.classList.remove('hidden');
                controlBarToggle.textContent = '×';
            } else {
                // 숨기기
                controlBar.classList.add('hidden');
                controlBarToggle.classList.add('hidden');
                controlBarToggle.textContent = '⚙';
            }
        });
    }

    // DOMContentLoaded 이벤트 리스너 안에서 호출
    setupToggleFeatures();

    // 윈도우 리사이즈
    window.addEventListener('resize', () => {
        resizeWaveformCanvas();
        if (waveformData) {
            drawWaveform();
        }
    });

    // 볼륨 컨트롤 이벤트 리스너 (DOMContentLoaded 안에 추가)
    const musicVolumeSlider = document.getElementById("music-volume");
    const sfxVolumeSlider = document.getElementById("sfx-volume");
    const musicVolumeDisplay = document.getElementById("music-volume-display");
    const sfxVolumeDisplay = document.getElementById("sfx-volume-display");

    // 음악 볼륨 조절
    musicVolumeSlider.addEventListener("input", (e) => {
        musicVolume = parseInt(e.target.value) / 100;
        demoAudio.volume = musicVolume;
        musicVolumeDisplay.textContent = e.target.value + "%";
        localStorage.setItem("musicVolume", musicVolume);
    });

    // 효과음 볼륨 조절
    sfxVolumeSlider.addEventListener("input", (e) => {
        sfxVolume = parseInt(e.target.value) / 100;
        sfxVolumeDisplay.textContent = e.target.value + "%";

        // 모든 사운드 풀의 볼륨 업데이트
        [...tabSoundPool, ...directionSoundPool].forEach(audio => {
            audio.volume = sfxVolume;
        });

        localStorage.setItem("sfxVolume", sfxVolume);
    });

    // 저장된 볼륨 설정 로드
    const savedMusicVolume = localStorage.getItem("musicVolume");
    const savedSfxVolume = localStorage.getItem("sfxVolume");

    if (savedMusicVolume !== null) {
        musicVolume = parseFloat(savedMusicVolume);
        musicVolumeSlider.value = Math.round(musicVolume * 100);
        musicVolumeDisplay.textContent = Math.round(musicVolume * 100) + "%";
        demoAudio.volume = musicVolume;
    }

    if (savedSfxVolume !== null) {
        sfxVolume = parseFloat(savedSfxVolume);
        sfxVolumeSlider.value = Math.round(sfxVolume * 100);
        sfxVolumeDisplay.textContent = Math.round(sfxVolume * 100) + "%";
    }

    // 초기 그리기
    ensureInitialDirectionNote();
    loadFromStorage();

    // 사운드 파일 로드
    loadNoteSounds();

    drawPath();
    renderNoteList();

    console.log('Initialization complete');
});

function isMacOS() {
    return navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
    navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
}

// Mac OS용 pre-delay 조정값
const MAC_DELAY_OFFSET = 800; // ms

function loadNoteSounds() {
    try {
        // Tab 사운드 풀 생성 (sfx/tab.mp3 사용)
        tabSoundPool = [];
        for (let i = 0; i < SOUND_POOL_SIZE; i++) {
            const audio = new Audio('sfx/tab.mp3');
            audio.volume = sfxVolume; // 효과음 볼륨 적용
            audio.preload = 'auto';
            tabSoundPool.push(audio);
        }

        // Direction 사운드 풀 생성 (tab.mp3와 동일한 파일 사용)
        directionSoundPool = [];
        for (let i = 0; i < SOUND_POOL_SIZE; i++) {
            const audio = new Audio('sfx/tab.mp3');
            audio.volume = sfxVolume; // 효과음 볼륨 적용
            audio.preload = 'auto';
            directionSoundPool.push(audio);
        }

        console.log(`Note sound pools loaded: ${SOUND_POOL_SIZE} instances each (using sfx/tab.mp3)`);
    } catch (error) {
        console.warn('Failed to load note sounds:', error);
        tabSoundPool = [];
        directionSoundPool = [];
    }
}
