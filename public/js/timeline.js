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
        
        this.init();
    }
    
    async init() {
        try {
            await this.openDatabase();
            await this.loadSnapshots();
            this.setupEventListeners();
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
            
            this.goToSnapshot(index);
        });
        
        this.setupWheelScroll();
    }
    
    setupWheelScroll() {
        const canvas = document.getElementById('three-canvas');
        
        canvas.addEventListener('wheel', (e) => {
            if (this.snapshots.length === 0) return;
            
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                
                const step = e.deltaY > 0 ? 1 : -1;
                const newIndex = Math.max(0, Math.min(this.snapshots.length - 1, this.currentIndex + step));
                
                if (newIndex !== this.currentIndex) {
                    this.goToSnapshot(newIndex);
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
            this.physicsEngine.restoreState(snapshot.state);
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
        if (this.snapshots.length === 0) return;
        
        this.isPlaying = true;
        
        if (this.currentIndex < 0 || this.currentIndex >= this.snapshots.length - 1) {
            this.currentIndex = 0;
        }
        
        this.playbackInterval = setInterval(() => {
            if (this.currentIndex < this.snapshots.length - 1) {
                this.currentIndex++;
                this.goToSnapshot(this.currentIndex);
            } else {
                this.stopPlayback();
                document.getElementById('btn-timeline-play').textContent = '▶️ 播放';
                document.getElementById('btn-timeline-play').classList.remove('active');
            }
        }, 500);
    }
    
    stopPlayback() {
        this.isPlaying = false;
        
        if (this.playbackInterval) {
            clearInterval(this.playbackInterval);
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
        
        const existingPoints = this.track.querySelectorAll('.snapshot-point, .snapshot-label');
        existingPoints.forEach(el => el.remove());
        
        this.snapshots.forEach((snapshot, index) => {
            const percentage = (index / Math.max(this.snapshots.length - 1, 1)) * 100;
            
            const point = document.createElement('div');
            point.className = 'snapshot-point';
            if (index === this.currentIndex) {
                point.classList.add('current');
            }
            point.style.left = `${percentage}%`;
            point.title = snapshot.label;
            
            point.addEventListener('click', (e) => {
                e.stopPropagation();
                this.goToSnapshot(index);
            });
            
            this.track.appendChild(point);
            
            if (index === 0 || index === this.snapshots.length - 1 || index % 5 === 0) {
                const label = document.createElement('div');
                label.className = 'snapshot-label';
                label.style.left = `${percentage}%`;
                label.textContent = this.formatShortTimestamp(snapshot.timestamp);
                this.track.appendChild(label);
            }
        });
        
        if (this.currentIndex >= 0 && this.snapshots.length > 0) {
            const progress = (this.currentIndex / Math.max(this.snapshots.length - 1, 1)) * 100;
            this.marker.style.left = `${progress}%`;
            this.progress.style.width = `${progress}%`;
        } else {
            this.marker.style.left = '0%';
            this.progress.style.width = '0%';
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
    
    formatShortTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });
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
