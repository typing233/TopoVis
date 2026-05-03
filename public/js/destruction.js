class DestructionMode {
    constructor(physicsEngine, timelineManager) {
        this.physicsEngine = physicsEngine;
        this.timelineManager = timelineManager;
        
        this.isEnabled = false;
        this.removedNodes = new Set();
        this.removedLinks = new Set();
        this.collapseInProgress = false;
        
        this.originalState = null;
        
        this.onCollapseStart = null;
        this.onCollapseUpdate = null;
        this.onCollapseComplete = null;
    }
    
    enable() {
        this.isEnabled = true;
        
        if (this.physicsEngine) {
            this.originalState = this.physicsEngine.getState();
        }
        
        this.updateUI();
        
        document.getElementById('btn-mode-toggle').innerHTML = '<span>💥 破坏模式</span>';
        document.getElementById('btn-mode-toggle').classList.add('btn-danger');
        
        document.getElementById('mode-icon').className = 'mode-icon destruction';
        document.getElementById('mode-text').textContent = '破坏模式';
        
        document.getElementById('destruction-panel').style.display = 'block';
        document.getElementById('destruction-hint').style.display = 'block';
    }
    
    disable() {
        this.isEnabled = false;
        
        document.getElementById('btn-mode-toggle').innerHTML = '<span>🔄 正常模式</span>';
        document.getElementById('btn-mode-toggle').classList.remove('btn-danger');
        
        document.getElementById('mode-icon').className = 'mode-icon normal';
        document.getElementById('mode-text').textContent = '正常模式';
        
        document.getElementById('destruction-panel').style.display = 'none';
        document.getElementById('destruction-hint').style.display = 'none';
    }
    
    toggle() {
        if (this.isEnabled) {
            this.disable();
        } else {
            this.enable();
        }
        return this.isEnabled;
    }
    
    updateUI() {
        document.getElementById('stat-removed').textContent = this.removedNodes.size;
        document.getElementById('stat-disconnected').textContent = this.removedLinks.size;
    }
    
    async triggerCollapse(nodeId, animate = true) {
        if (this.collapseInProgress) return;
        if (this.removedNodes.has(nodeId)) return;
        
        this.collapseInProgress = true;
        
        document.getElementById('collapse-info').style.display = 'block';
        
        const collapseResult = await this.calculateCollapse(nodeId);
        
        await this.executeCollapse(collapseResult, animate);
        
        this.collapseInProgress = false;
        
        document.getElementById('collapse-info').style.display = 'none';
        
        this.updateUI();
        
        if (this.onCollapseComplete) {
            this.onCollapseComplete(collapseResult);
        }
        
        return collapseResult;
    }
    
    async calculateCollapse(startNodeId) {
        const visited = new Set();
        const queue = [startNodeId];
        const collapseOrder = [];
        const affectedNodes = new Set([startNodeId]);
        const affectedLinks = new Set();
        
        const nodeDegrees = new Map();
        const nodeImportance = new Map();
        
        if (this.physicsEngine && this.physicsEngine.nodes) {
            this.physicsEngine.nodes.forEach((node, id) => {
                if (!this.removedNodes.has(id)) {
                    const adjacent = this.physicsEngine.getAdjacentNodes(id);
                    const activeAdjacent = adjacent.filter(adjId => !this.removedNodes.has(adjId));
                    nodeDegrees.set(id, activeAdjacent.length);
                    
                    let importance = activeAdjacent.length;
                    activeAdjacent.forEach(adjId => {
                        const adjAdjacent = this.physicsEngine.getAdjacentNodes(adjId);
                        importance += adjAdjacent.length * 0.5;
                    });
                    nodeImportance.set(id, importance);
                }
            });
        }
        
        while (queue.length > 0) {
            const currentNodeId = queue.shift();
            
            if (visited.has(currentNodeId)) continue;
            visited.add(currentNodeId);
            collapseOrder.push(currentNodeId);
            affectedNodes.add(currentNodeId);
            
            if (this.physicsEngine) {
                const adjacent = this.physicsEngine.getAdjacentNodes(currentNodeId);
                
                adjacent.forEach(adjId => {
                    if (!this.removedNodes.has(adjId)) {
                        const currentDegree = nodeDegrees.get(adjId) || 0;
                        const newDegree = currentDegree - 1;
                        nodeDegrees.set(adjId, newDegree);
                        
                        const link = this.findLink(currentNodeId, adjId);
                        if (link) {
                            affectedLinks.add(link);
                        }
                        
                        const importance = nodeImportance.get(adjId) || 0;
                        const collapseThreshold = importance > 10 ? 0.3 : 0.5;
                        
                        if (newDegree <= Math.ceil(currentDegree * collapseThreshold)) {
                            if (!visited.has(adjId) && !queue.includes(adjId)) {
                                queue.push(adjId);
                            }
                        }
                    }
                });
            }
        }
        
        return {
            startNodeId,
            collapseOrder,
            affectedNodes: Array.from(affectedNodes),
            affectedLinks: Array.from(affectedLinks),
            totalNodes: affectedNodes.size,
            totalLinks: affectedLinks.size,
            depth: this.calculateCollapseDepth(startNodeId, affectedNodes)
        };
    }
    
    calculateCollapseDepth(startNodeId, affectedNodes) {
        if (!this.physicsEngine) return 1;
        
        const distances = new Map();
        const queue = [startNodeId];
        distances.set(startNodeId, 1);
        
        let maxDepth = 1;
        
        while (queue.length > 0) {
            const currentId = queue.shift();
            const currentDepth = distances.get(currentId);
            maxDepth = Math.max(maxDepth, currentDepth);
            
            const adjacent = this.physicsEngine.getAdjacentNodes(currentId);
            adjacent.forEach(adjId => {
                if (affectedNodes.has(adjId) && !distances.has(adjId)) {
                    distances.set(adjId, currentDepth + 1);
                    queue.push(adjId);
                }
            });
        }
        
        return maxDepth;
    }
    
    findLink(sourceId, targetId) {
        if (!this.physicsEngine || !this.physicsEngine.links) return null;
        
        for (let i = 0; i < this.physicsEngine.links.length; i++) {
            const link = this.physicsEngine.links[i];
            if ((link.sourceId === sourceId && link.targetId === targetId) ||
                (link.sourceId === targetId && link.targetId === sourceId)) {
                return i;
            }
        }
        return null;
    }
    
    async executeCollapse(collapseResult, animate = true) {
        const { collapseOrder, affectedNodes, affectedLinks, depth } = collapseResult;
        
        document.getElementById('collapse-count').textContent = `已影响: ${affectedNodes.length} 个节点`;
        document.getElementById('collapse-depth').textContent = `坍塌深度: ${depth}`;
        
        if (this.onCollapseStart) {
            this.onCollapseStart(collapseResult);
        }
        
        for (let i = 0; i < collapseOrder.length; i++) {
            const nodeId = collapseOrder[i];
            
            if (this.removedNodes.has(nodeId)) continue;
            
            this.removedNodes.add(nodeId);
            
            if (this.physicsEngine) {
                this.physicsEngine.removeNode(nodeId, animate);
            }
            
            if (animate && i < collapseOrder.length - 1) {
                const delay = Math.min(100, 300 / (i + 1));
                await this.sleep(delay);
            }
            
            if (this.onCollapseUpdate) {
                this.onCollapseUpdate({
                    current: i + 1,
                    total: collapseOrder.length,
                    nodeId,
                    removedNodes: this.removedNodes.size
                });
            }
            
            document.getElementById('collapse-count').textContent = `已影响: ${i + 1}/${affectedNodes.length} 个节点`;
        }
        
        affectedLinks.forEach(linkIndex => {
            this.removedLinks.add(linkIndex);
        });
    }
    
    reset() {
        this.removedNodes.clear();
        this.removedLinks.clear();
        this.collapseInProgress = false;
        
        if (this.physicsEngine && this.originalState) {
            this.physicsEngine.restoreState(this.originalState);
        } else if (this.physicsEngine && this.physicsEngine.nodes) {
            this.physicsEngine.nodes.forEach((node, id) => {
                this.physicsEngine.restoreNode(id);
            });
        }
        
        this.updateUI();
    }
    
    saveCurrentStateToTimeline(label = null) {
        if (this.timelineManager) {
            const timestamp = new Date().toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            
            let snapshotLabel = label || `破坏后状态 - ${timestamp}`;
            if (this.removedNodes.size > 0) {
                snapshotLabel = `移除${this.removedNodes.size}节点 - ${timestamp}`;
            }
            
            this.timelineManager.captureSnapshot(snapshotLabel);
        }
    }
    
    getRemovedNodes() {
        return Array.from(this.removedNodes);
    }
    
    getRemovedLinks() {
        return Array.from(this.removedLinks);
    }
    
    getCollapseStatistics() {
        return {
            totalNodes: this.physicsEngine ? this.physicsEngine.nodes.size : 0,
            removedNodes: this.removedNodes.size,
            removedLinks: this.removedLinks.size,
            survivalRate: this.physicsEngine ? 
                ((this.physicsEngine.nodes.size - this.removedNodes.size) / this.physicsEngine.nodes.size * 100).toFixed(1) : 0
        };
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

window.DestructionMode = DestructionMode;
