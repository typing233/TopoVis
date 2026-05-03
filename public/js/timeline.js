class TimelineScrollController {
    constructor(timelineManager) {
        this.timelineManager = timelineManager;
        this.physicsEngine = timelineManager.physicsEngine;
        
        this.isScrolling = false;
        this.scrollProgress = 0;
        this.currentFromIndex = -1;
        this.currentToIndex = -1;
        this.animationFrame = null;
        
        this.velocity = 0;
        this.lastScrollTime = 0;
        this.scrollThreshold = 50;
        
        this.isInTransition = false;
        this.transitionProgress = 0;
        this.transitionFrom = null;
        this.transitionTo = null;
        
        this.scrollAccumulator = 0;
        this.cooldownTime = 100;
        this.lastScrollDelta = 0;
    }
    
    handleWheel(deltaY) {
        if (this.timelineManager.snapshots.length < 2) return;
        
        const currentTime = Date.now();
        const timeSinceLastScroll = currentTime - this.lastScrollTime;
        
        if (timeSinceLastScroll > this.cooldownTime) {
            this.scrollAccumulator = 0;
        }
        
        this.lastScrollTime = currentTime;
        this.scrollAccumulator += deltaY;
        
        if (Math.abs(this.scrollAccumulator) >= this.scrollThreshold) {
            const direction = this.scrollAccumulator > 0 ? 1 : -1;
            this.scrollAccumulator = 0;
            
            this.navigateByStep(direction);
        }
    }
    
    navigateByStep(direction) {
        const currentIndex = this.timelineManager.currentIndex;
        let newIndex;
        
        if (direction > 0) {
            newIndex = Math.min(this.timelineManager.snapshots.length - 1, currentIndex + 1);
        } else {
            newIndex = Math.max(0, currentIndex - 1);
        }
        
        if (newIndex !== currentIndex) {
            this.goToIndexWithTransition(newIndex);
        }
    }
    
    async goToIndexWithTransition(targetIndex) {
        if (this.isInTransition) return;
        
        const currentIndex = this.timelineManager.currentIndex;
        
        if (targetIndex === currentIndex) return;
        if (targetIndex < 0 || targetIndex >= this.timelineManager.snapshots.length) return;
        
        this.isInTransition = true;
        
        const fromSnapshot = this.timelineManager.snapshots[currentIndex];
        const toSnapshot = this.timelineManager.snapshots[targetIndex];
        
        if (!fromSnapshot || !toSnapshot) {
            this.timelineManager.goToSnapshot(targetIndex);
            this.isInTransition = false;
            return;
        }
        
        this.showTransitionIndicator(currentIndex, targetIndex);
        
        if (this.physicsEngine && this.physicsEngine.transitionSystem) {
            this.physicsEngine.isPhysicsEnabled = false;
            
            await this.physicsEngine.transitionSystem.startTransition(
                { nodes: fromSnapshot.state.nodes.map(n => ({
                    id: n.id,
                    position: new THREE.Vector3(n.position.x, n.position.y, n.position.z),
                    velocity: new THREE.Vector3(n.velocity.x, n.velocity.y, n.velocity.z)
                })) },
                { nodes: toSnapshot.state.nodes.map(n => ({
                    id: n.id,
                    position: new THREE.Vector3(n.position.x, n.position.y, n.position.z),
                    velocity: new THREE.Vector3(n.velocity.x, n.velocity.y, n.velocity.z)
                })) },
                this.physicsEngine.nodes,
                600
            );
            
            if (toSnapshot.state.cameraPosition && toSnapshot.state.cameraTarget) {
                await this.physicsEngine.transitionSystem.startCameraTransition(
                    this.physicsEngine.camera,
                    this.physicsEngine.controls,
                    new THREE.Vector3(
                        toSnapshot.state.cameraPosition.x,
                        toSnapshot.state.cameraPosition.y,
                        toSnapshot.state.cameraPosition.z
                    ),
                    new THREE.Vector3(
                        toSnapshot.state.cameraTarget.x,
                        toSnapshot.state.cameraTarget.y,
                        toSnapshot.state.cameraTarget.z
                    ),
                    400
                );
            }
            
            this.physicsEngine.isPhysicsEnabled = true;
        }
        
        this.timelineManager.currentIndex = targetIndex;
        this.timelineManager.updateTimelineUI();
        
        if (this.timelineManager.onSnapshotChange) {
            this.timelineManager.onSnapshotChange(targetIndex, toSnapshot);
        }
        
        this.isInTransition = false;
    }
    
    showTransitionIndicator(fromIndex, toIndex) {
        const track = document.getElementById('timeline-track');
        
        const indicator = document.createElement('div');
        indicator.className = 'transition-indicator';
        indicator.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.3), transparent);
            border-radius: 8px;
            opacity: 1;
            transition: opacity 0.3s;
            pointer-events: none;
            z-index: 5;
        `;
        
        track.appendChild(indicator);
        
        setTimeout(() => {
            indicator.style.opacity = '0';
            setTimeout(() => indicator.remove(), 300);
        }, 200);
    }
    
    startSmoothPlayback(fromIndex, toIndex, durationPerStep = 800) {
        if (this.isInTransition) return;
        
        const startIndex = fromIndex;
        const endIndex = toIndex;
        const step = startIndex < endIndex ? 1 : -1;
        
        const playNext = async (current) => {
            if (current === endIndex + (step > 0 ? 0 : -1)) {
                this.timelineManager.stopPlayback();
                return;
            }
            
            await this.goToIndexWithTransition(current);
            
            if (this.timelineManager.isPlaying) {
                setTimeout(() => playNext(current + step), 200);
            }
        };
        
        playNext(startIndex + step);
    }
}

class TimelineVisualizer {
    constructor(timelineManager) {
        this.timelineManager = timelineManager;
        this.waveAnimationId = null;
        this.waveProgress = 0;
    }
    
    createTimelineVisualization() {
        this.createWaveCanvas();
        this.updateSnapshotPoints();
    }
    
    createWaveCanvas() {
        const track = document.getElementById('timeline-track');
        
        const oldCanvas = track.querySelector('.wave-canvas');
        if (oldCanvas) oldCanvas.remove();
        
        const canvas = document.createElement('canvas');
        canvas.className = 'wave-canvas';
        canvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1;
            border-radius: 8px;
        `;
        
        track.insertBefore(canvas, track.firstChild);
        this.waveCanvas = canvas;
        
        this.animateWave();
    }
    
    animateWave() {
        if (!this.waveCanvas) return;
        
        const ctx = this.waveCanvas.getContext('2d');
        const rect = this.waveCanvas.getBoundingClientRect();
        
        this.waveCanvas.width = rect.width * window.devicePixelRatio;
        this.waveCanvas.height = rect.height * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        
        ctx.clearRect(0, 0, rect.width, rect.height);
        
        const snapshots = this.timelineManager.snapshots;
        
        if (snapshots.length < 2) {
            this.waveAnimationId = requestAnimationFrame(() => this.animateWave());
            return;
        }
        
        this.waveProgress += 0.02;
        
        const currentIndex = this.timelineManager.currentIndex;
        
        ctx.beginPath();
        ctx.moveTo(0, rect.height / 2);
        
        for (let i = 0; i <= rect.width; i++) {
            const t = i / rect.width;
            const snapshotIndex = Math.round(t * (snapshots.length - 1));
            const snapshot = snapshots[snapshotIndex];
            
            let intensity = 0.3;
            
            if (snapshotIndex <= currentIndex) {
                intensity = 0.6;
            }
            
            if (snapshotIndex === currentIndex) {
                intensity = 1;
            }
            
            const wave = Math.sin(this.waveProgress + t * 8) * 8 * intensity;
            const y = rect.height / 2 + wave;
            
            ctx.lineTo(i, y);
        }
        
        ctx.lineTo(rect.width, rect.height / 2);
        
        const gradient = ctx.createLinearGradient(0, 0, rect.width, 0);
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.1)');
        gradient.addColorStop(0.5, 'rgba(139, 92, 246, 0.3)');
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0.1)');
        
        ctx.fillStyle = gradient;
        ctx.fill();
        
        ctx.beginPath();
        ctx.moveTo(0, rect.height / 2);
        
        for (let i = 0; i <= rect.width; i++) {
            const t = i / rect.width;
            const snapshotIndex = Math.round(t * (snapshots.length - 1));
            
            let intensity = 0.3;
            if (snapshotIndex <= currentIndex) {
                intensity = 0.8;
            }
            if (snapshotIndex === currentIndex) {
                intensity = 1.5;
            }
            
            const wave = Math.sin(this.waveProgress + t * 8) * 6 * intensity;
            const y = rect.height / 2 + wave;
            
            ctx.lineTo(i, y);
        }
        
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        this.waveAnimationId = requestAnimationFrame(() => this.animateWave());
    }
    
    updateSnapshotPoints() {
        const track = document.getElementById('timeline-track');
        
        track.querySelectorAll('.snapshot-point, .snapshot-label, .snapshot-connector').forEach(el => el.remove());
        
        const snapshots = this.timelineManager.snapshots;
        const currentIndex = this.timelineManager.currentIndex;
        
        if (snapshots.length === 0) return;
        
        const positions = snapshots.map((_, i) => ({
            percentage: (i / Math.max(snapshots.length - 1, 1)) * 100,
            index: i
        }));
        
        positions.forEach((pos, index) => {
            const snapshot = snapshots[index];
            const isCurrent = index === currentIndex;
            const isPast = index < currentIndex;
            
            const point = document.createElement('div');
            point.className = `snapshot-point ${isCurrent ? 'current' : ''} ${isPast ? 'past' : ''}`;
            point.style.left = `${pos.percentage}%`;
            point.title = snapshot.label;
            point.dataset.index = index;
            
            if (isCurrent) {
                point.innerHTML = `
                    <div style="
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        width: 24px;
                        height: 24px;
                        border-radius: 50%;
                        background: rgba(251, 191, 36, 0.3);
                        animation: pulse-ring 1.5s ease-out infinite;
                    "></div>
                `;
            }
            
            point.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(e.currentTarget.dataset.index);
                if (this.timelineManager.scrollController) {
                    this.timelineManager.scrollController.goToIndexWithTransition(idx);
                } else {
                    this.timelineManager.goToSnapshot(idx);
                }
            });
            
            track.appendChild(point);
            
            if (index > 0) {
                const prevPos = positions[index - 1];
                const connector = document.createElement('div');
                connector.className = `snapshot-connector ${isPast ? 'past' : ''}`;
                connector.style.cssText = `
                    position: absolute;
                    top: 50%;
                    left: ${prevPos.percentage}%;
                    width: ${pos.percentage - prevPos.percentage}%;
                    height: 2px;
                    background: ${isPast ? 'linear-gradient(90deg, #6366f1, #8b5cf6)' : 'rgba(148, 163, 184, 0.3)'};
                    transform: translateY(-50%);
                    z-index: 2;
                    transition: background 0.3s;
                `;
                track.appendChild(connector);
            }
            
            if (index === 0 || index === snapshots.length - 1 || index % Math.ceil(snapshots.length / 5) === 0) {
                const label = document.createElement('div');
                label.className = 'snapshot-label';
                label.style.left = `${pos.percentage}%`;
                label.textContent = this.formatShortLabel(snapshot, index);
                track.appendChild(label);
            }
        });
        
        if (!document.getElementById('pulse-animation')) {
            const style = document.createElement('style');
            style.id = 'pulse-animation';
            style.textContent = `
                @keyframes pulse-ring {
                    0% {
                        transform: translate(-50%, -50%) scale(0.8);
                        opacity: 1;
                    }
                    100% {
                        transform: translate(-50%, -50%) scale(1.5);
                        opacity: 0;
                    }
                }
                
                .snapshot-point.past {
                    background: #6366f1 !important;
                    border-color: #818cf8 !important;
                }
                
                .snapshot-point.current {
                    background: #fbbf24 !important;
                    border-color: #f59e0b !important;
                    box-shadow: 0 0 15px rgba(251, 191, 36, 0.5);
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    formatShortLabel(snapshot, index) {
        if (snapshot.label && !snapshot.label.includes(':')) {
            return snapshot.label;
        }
        
        return `#${index + 1}`;
    }
    
    updateProgress() {
        const marker = document.getElementById('timeline-marker');
        const progress = document.getElementById('timeline-progress');
        const snapshots = this.timelineManager.snapshots;
        const currentIndex = this.timelineManager.currentIndex;
        
        if (snapshots.length > 0) {
            const percentage = (currentIndex / Math.max(snapshots.length - 1, 1)) * 100;
            marker.style.left = `${percentage}%`;
            progress.style.width = `${percentage}%`;
        }
        
        this.updateSnapshotPoints();
    }
    
    destroy() {
        if (this.waveAnimationId) {
            cancelAnimationFrame(this.waveAnimationId);
        }
    }
}

class TimelineManager {
    constructor(physicsEngine) {
        this.physicsEngine = physicsEngine;
        this.dbName = 'TopoVisTimeline';
        this.dbVersion = 1;
        this.db = null;
        
        this.snapshots = [];
        this.currentIndex = -1;
        this.isRecording = false;
        this.isPlaying = false;
        this.playbackInterval = null;
        
        this.recordInterval = 1000;
        this.recordTimer = null;
        
        this.maxSnapshots = 50;
        
        this.container = document.getElementById('timeline-container');
        this.track = document.getElementById('timeline-track');
        this.marker = document.getElementById('timeline-marker');
        this.progress = document.getElementById('timeline-progress');
        this.hint = document.getElementById('timeline-hint');
        
        this.onSnapshotChange = null;
        
        this.scrollController = new TimelineScrollController(this);
        this.visualizer = new TimelineVisualizer(this);
        
        this.init();
    }
    
    async init() {
        try {
            await this.openDatabase();
            await this.loadSnapshots();
            this.setupEventListeners();
            this.visualizer.createTimelineVisualization();
        } catch (error) {
            console.error('TimelineManager init error:', error);
        }
    }
    
    openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                if (!db.objectStoreNames.contains('snapshots')) {
                    const store = db.createObjectStore('snapshots', { 
                        keyPath: 'id', 
                        autoIncrement: true 
                    });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('sessionId', 'sessionId', { unique: false });
                }
            };
        });
    }
    
    async loadSnapshots() {
        if (!this.db) return;
        
        const transaction = this.db.transaction(['snapshots'], 'readonly');
        const store = transaction.objectStore('snapshots');
        const index = store.index('timestamp');
        
        const request = index.getAll();
        
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                this.snapshots = request.result || [];
                this.updateTimelineUI();
                resolve(this.snapshots);
            };
            request.onerror = () => reject(request.error);
        });
    }
    
    setupEventListeners() {
        document.getElementById('btn-timeline-record').addEventListener('click', () => {
            this.toggleRecording();
        });
        
        document.getElementById('btn-timeline-play').addEventListener('click', () => {
            this.togglePlayback();
        });
        
        document.getElementById('btn-timeline-clear').addEventListener('click', () => {
            this.clearSnapshots();
        });
        
        this.track.addEventListener('click', (e) => {
            if (this.snapshots.length === 0) return;
            
            const rect = this.track.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percentage = x / rect.width;
            const index = Math.round(percentage * (this.snapshots.length - 1));
            
            if (this.scrollController) {
                this.scrollController.goToIndexWithTransition(index);
            } else {
                this.goToSnapshot(index);
            }
        });
        
        this.setupWheelScroll();
    }
    
    setupWheelScroll() {
        const canvas = document.getElementById('three-canvas');
        
        canvas.addEventListener('wheel', (e) => {
            if (this.snapshots.length < 2) return;
            
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                
                if (this.scrollController) {
                    this.scrollController.handleWheel(e.deltaY);
                } else {
                    const step = e.deltaY > 0 ? 1 : -1;
                    const newIndex = Math.max(0, Math.min(this.snapshots.length - 1, this.currentIndex + step));
                    
                    if (newIndex !== this.currentIndex) {
                        this.goToSnapshot(newIndex);
                    }
                }
            }
        }, { passive: false });
    }
    
    toggleRecording() {
        const btn = document.getElementById('btn-timeline-record');
        
        if (this.isRecording) {
            this.stopRecording();
            btn.textContent = '📹 录制';
            btn.classList.remove('active');
        } else {
            this.startRecording();
            btn.textContent = '⏹️ 停止';
            btn.classList.add('active');
        }
    }
    
    startRecording() {
        if (this.isRecording) return;
        
        this.isRecording = true;
        this.hint.style.display = 'none';
        
        this.captureSnapshot('录制开始');
        
        this.recordTimer = setInterval(() => {
            this.captureSnapshot();
        }, this.recordInterval);
    }
    
    stopRecording() {
        if (!this.isRecording) return;
        
        this.isRecording = false;
        
        if (this.recordTimer) {
            clearInterval(this.recordTimer);
            this.recordTimer = null;
        }
    }
    
    async captureSnapshot(label = null) {
        if (!this.physicsEngine) return;
        
        const state = this.physicsEngine.getState();
        
        const snapshot = {
            timestamp: Date.now(),
            sessionId: this.getSessionId(),
            state: state,
            label: label || this.formatTimestamp(Date.now()),
            removedNodes: state.removedNodes || []
        };
        
        if (this.db) {
            try {
                const transaction = this.db.transaction(['snapshots'], 'readwrite');
                const store = transaction.objectStore('snapshots');
                
                const countRequest = store.count();
                countRequest.onsuccess = () => {
                    if (countRequest.result >= this.maxSnapshots) {
                        const cursorRequest = store.openCursor();
                        cursorRequest.onsuccess = (e) => {
                            const cursor = e.target.result;
                            if (cursor) {
                                cursor.delete();
                            }
                        };
                    }
                    
                    const addRequest = store.add(snapshot);
                    addRequest.onsuccess = () => {
                        snapshot.id = addRequest.result;
                        this.snapshots.push(snapshot);
                        this.currentIndex = this.snapshots.length - 1;
                        this.updateTimelineUI();
                    };
                };
            } catch (error) {
                console.error('Failed to save snapshot:', error);
                this.snapshots.push(snapshot);
                this.currentIndex = this.snapshots.length - 1;
                this.updateTimelineUI();
            }
        } else {
            this.snapshots.push(snapshot);
            this.currentIndex = this.snapshots.length - 1;
            this.updateTimelineUI();
        }
    }
    
    goToSnapshot(index) {
        if (index < 0 || index >= this.snapshots.length) return;
        
        const snapshot = this.snapshots[index];
        this.currentIndex = index;
        
        if (this.physicsEngine && snapshot.state) {
            this.physicsEngine.restoreState(snapshot.state, true);
        }
        
        this.updateTimelineUI();
        
        if (this.onSnapshotChange) {
            this.onSnapshotChange(index, snapshot);
        }
    }
    
    togglePlayback() {
        const btn = document.getElementById('btn-timeline-play');
        
        if (this.isPlaying) {
            this.stopPlayback();
            btn.textContent = '▶️ 播放';
            btn.classList.remove('active');
        } else {
            this.startPlayback();
            btn.textContent = '⏸️ 暂停';
            btn.classList.add('active');
        }
    }
    
    startPlayback() {
        if (this.snapshots.length < 2) return;
        
        this.isPlaying = true;
        
        if (this.currentIndex < 0 || this.currentIndex >= this.snapshots.length - 1) {
            this.currentIndex = -1;
        }
        
        const playNext = async () => {
            if (!this.isPlaying) return;
            
            const nextIndex = this.currentIndex + 1;
            
            if (nextIndex >= this.snapshots.length) {
                this.stopPlayback();
                document.getElementById('btn-timeline-play').textContent = '▶️ 播放';
                document.getElementById('btn-timeline-play').classList.remove('active');
                return;
            }
            
            if (this.scrollController) {
                await this.scrollController.goToIndexWithTransition(nextIndex);
            } else {
                this.goToSnapshot(nextIndex);
            }
            
            if (this.isPlaying) {
                this.playbackInterval = setTimeout(playNext, 300);
            }
        };
        
        playNext();
    }
    
    stopPlayback() {
        this.isPlaying = false;
        
        if (this.playbackInterval) {
            clearTimeout(this.playbackInterval);
            this.playbackInterval = null;
        }
    }
    
    async clearSnapshots() {
        this.snapshots = [];
        this.currentIndex = -1;
        
        if (this.db) {
            const transaction = this.db.transaction(['snapshots'], 'readwrite');
            const store = transaction.objectStore('snapshots');
            store.clear();
        }
        
        this.updateTimelineUI();
    }
    
    updateTimelineUI() {
        this.hint.style.display = this.snapshots.length === 0 ? 'block' : 'none';
        
        if (this.visualizer) {
            this.visualizer.updateProgress();
        }
    }
    
    getSessionId() {
        if (!this.sessionId) {
            this.sessionId = Date.now().toString();
        }
        return this.sessionId;
    }
    
    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
    
    formatShortLabel(snapshot, index) {
        if (snapshot.label && !snapshot.label.includes(':')) {
            return snapshot.label;
        }
        return `#${index + 1}`;
    }
    
    getCurrentSnapshot() {
        if (this.currentIndex >= 0 && this.currentIndex < this.snapshots.length) {
            return this.snapshots[this.currentIndex];
        }
        return null;
    }
    
    getAllSnapshots() {
        return this.snapshots;
    }
    
    getSnapshotCount() {
        return this.snapshots.length;
    }
}

window.TimelineManager = TimelineManager;
