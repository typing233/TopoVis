class TopoVisApp {
    constructor() {
        this.graphData = null;
        this.simulation = null;
        this.gl = null;
        this.canvas = null;
        this.svg = null;
        this.isPaused = false;
        this.showLabels = true;
        this.showEdges = true;
        this.selectedNode = null;
        this.highlightedNodes = new Set();
        this.highlightedEdges = new Set();
        this.llmConfig = this.loadLLMConfig();
        this.communityColors = {};
        
        this.colorScale = d3.scaleOrdinal()
            .range([
                '#ef4444', '#f97316', '#eab308', '#22c55e', 
                '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
                '#06b6d4', '#f59e0b', '#84cc16', '#6366f1',
                '#a855f7', '#d946ef', '#0ea5e9', '#10b981'
            ]);
        
        this.init();
    }
    
    init() {
        this.canvas = document.getElementById('gl-canvas');
        this.svg = d3.select('#overlay-svg');
        this.setupCanvas();
        this.setupWebGL();
        this.setupEventListeners();
    }
    
    setupCanvas() {
        const container = document.getElementById('graph-canvas');
        const resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                this.canvas.width = width * window.devicePixelRatio;
                this.canvas.height = height * window.devicePixelRatio;
                this.canvas.style.width = width + 'px';
                this.canvas.style.height = height + 'px';
                
                this.svg
                    .attr('width', width)
                    .attr('height', height);
                
                if (this.gl) {
                    this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
                }
            }
        });
        
        resizeObserver.observe(container);
    }
    
    setupWebGL() {
        this.gl = this.canvas.getContext('webgl', { 
            antialias: true, 
            alpha: true,
            preserveDrawingBuffer: true 
        });
        
        if (!this.gl) {
            console.error('WebGL not supported');
            return;
        }
        
        const gl = this.gl;
        
        const vertexShaderSource = `
            attribute vec2 a_position;
            attribute float a_size;
            attribute vec4 a_color;
            attribute float a_isNode;
            
            uniform mat4 u_matrix;
            uniform vec2 u_resolution;
            
            varying vec4 v_color;
            varying float v_isNode;
            
            void main() {
                vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
                clipSpace.y = -clipSpace.y;
                gl_Position = vec4(clipSpace, 0.0, 1.0);
                gl_PointSize = a_size;
                v_color = a_color;
                v_isNode = a_isNode;
            }
        `;
        
        const fragmentShaderSource = `
            precision mediump float;
            
            varying vec4 v_color;
            varying float v_isNode;
            
            void main() {
                if (v_isNode > 0.5) {
                    vec2 coord = gl_PointCoord - vec2(0.5);
                    float dist = length(coord);
                    if (dist > 0.5) {
                        discard;
                    }
                    float alpha = 1.0 - smoothstep(0.45, 0.5, dist);
                    gl_FragColor = vec4(v_color.rgb, v_color.a * alpha);
                } else {
                    gl_FragColor = v_color;
                }
            }
        `;
        
        const vertexShader = this.createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
        
        this.program = this.createProgram(gl, vertexShader, fragmentShader);
        
        this.positionLocation = gl.getAttribLocation(this.program, 'a_position');
        this.sizeLocation = gl.getAttribLocation(this.program, 'a_size');
        this.colorLocation = gl.getAttribLocation(this.program, 'a_color');
        this.isNodeLocation = gl.getAttribLocation(this.program, 'a_isNode');
        
        this.matrixLocation = gl.getUniformLocation(this.program, 'u_matrix');
        this.resolutionLocation = gl.getUniformLocation(this.program, 'u_resolution');
        
        this.positionBuffer = gl.createBuffer();
        this.colorBuffer = gl.createBuffer();
        this.sizeBuffer = gl.createBuffer();
        this.isNodeBuffer = gl.createBuffer();
    }
    
    createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        
        return shader;
    }
    
    createProgram(gl, vertexShader, fragmentShader) {
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(program));
            gl.deleteProgram(program);
            return null;
        }
        
        return program;
    }
    
    setupEventListeners() {
        const uploadArea = document.getElementById('upload-area');
        const fileInput = document.getElementById('file-input');
        const btnSelectFile = document.getElementById('btn-select-file');
        const btnUpload = document.getElementById('btn-upload');
        const btnRemoveFile = document.getElementById('btn-remove-file');
        
        btnSelectFile.addEventListener('click', () => fileInput.click());
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileSelect(files[0]);
            }
        });
        
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFileSelect(e.target.files[0]);
            }
        });
        
        btnUpload.addEventListener('click', () => this.uploadFile());
        btnRemoveFile.addEventListener('click', () => this.clearFile());
        
        document.getElementById('btn-zoom-in').addEventListener('click', () => this.zoom(1.2));
        document.getElementById('btn-zoom-out').addEventListener('click', () => this.zoom(0.8));
        document.getElementById('btn-zoom-reset').addEventListener('click', () => this.resetZoom());
        document.getElementById('btn-pause').addEventListener('click', () => this.togglePause());
        document.getElementById('btn-center').addEventListener('click', () => this.centerView());
        
        document.getElementById('toggle-labels').addEventListener('change', (e) => {
            this.showLabels = e.target.checked;
            this.render();
        });
        
        document.getElementById('toggle-edges').addEventListener('change', (e) => {
            this.showEdges = e.target.checked;
            this.render();
        });
        
        document.getElementById('btn-close-node').addEventListener('click', () => {
            this.hideNodeInfo();
        });
        
        document.getElementById('btn-settings').addEventListener('click', () => {
            this.showSettingsModal();
        });
        
        document.getElementById('btn-close-modal').addEventListener('click', () => {
            this.hideSettingsModal();
        });
        
        document.getElementById('btn-test-connection').addEventListener('click', () => {
            this.testLLMConnection();
        });
        
        document.getElementById('btn-save-settings').addEventListener('click', () => {
            this.saveLLMConfig();
        });
        
        document.getElementById('settings-modal').addEventListener('click', (e) => {
            if (e.target.id === 'settings-modal') {
                this.hideSettingsModal();
            }
        });
        
        document.getElementById('btn-llm-analyze').addEventListener('click', () => {
            this.runLLMAnalysis();
        });
        
        this.setupCanvasInteractions();
    }
    
    setupCanvasInteractions() {
        let isDragging = false;
        let startX, startY;
        let lastMouseX, lastMouseY;
        
        this.canvas.addEventListener('mousedown', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const node = this.getNodeAtPosition(x, y);
            
            if (node) {
                if (this.simulation) {
                    node.fx = node.x;
                    node.fy = node.y;
                    this.simulation.alphaTarget(0.3).restart();
                }
                isDragging = true;
                this.draggingNode = node;
                this.selectNode(node);
            } else {
                isDragging = true;
                startX = x;
                startY = y;
            }
            
            lastMouseX = x;
            lastMouseY = y;
        });
        
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            if (isDragging) {
                if (this.draggingNode) {
                    const transform = this.getCurrentTransform();
                    const transformedX = (x - transform.translateX) / transform.scale;
                    const transformedY = (y - transform.translateY) / transform.scale;
                    
                    this.draggingNode.fx = transformedX;
                    this.draggingNode.fy = transformedY;
                } else {
                    const dx = x - lastMouseX;
                    const dy = y - lastMouseY;
                    this.pan(dx, dy);
                }
                lastMouseX = x;
                lastMouseY = y;
            } else {
                const node = this.getNodeAtPosition(x, y);
                this.canvas.style.cursor = node ? 'pointer' : 'default';
            }
        });
        
        this.canvas.addEventListener('mouseup', () => {
            if (this.draggingNode && this.simulation) {
                this.draggingNode.fx = null;
                this.draggingNode.fy = null;
                this.simulation.alphaTarget(0);
            }
            isDragging = false;
            this.draggingNode = null;
        });
        
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            this.zoomAt(x, y, delta);
        });
        
        this.canvas.addEventListener('dblclick', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const node = this.getNodeAtPosition(x, y);
            if (node) {
                this.drillDown(node);
            }
        });
    }
    
    getNodeAtPosition(screenX, screenY) {
        if (!this.graphData || !this.graphData.nodes) return null;
        
        const transform = this.getCurrentTransform();
        const x = (screenX - transform.translateX) / transform.scale;
        const y = (screenY - transform.translateY) / transform.scale;
        
        for (const node of this.graphData.nodes) {
            const dx = node.x - x;
            const dy = node.y - y;
            const radius = this.getNodeRadius(node);
            
            if (dx * dx + dy * dy <= radius * radius) {
                return node;
            }
        }
        
        return null;
    }
    
    getCurrentTransform() {
        if (!this.zoomTransform) {
            this.zoomTransform = { scale: 1, translateX: 0, translateY: 0 };
        }
        return this.zoomTransform;
    }
    
    zoom(factor) {
        const rect = this.canvas.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        this.zoomAt(centerX, centerY, factor);
    }
    
    zoomAt(screenX, screenY, factor) {
        const transform = this.getCurrentTransform();
        
        const newScale = Math.max(0.1, Math.min(10, transform.scale * factor));
        const scaleChange = newScale / transform.scale;
        
        const translateX = screenX - (screenX - transform.translateX) * scaleChange;
        const translateY = screenY - (screenY - transform.translateY) * scaleChange;
        
        this.zoomTransform = {
            scale: newScale,
            translateX: translateX,
            translateY: translateY
        };
        
        this.render();
    }
    
    pan(dx, dy) {
        const transform = this.getCurrentTransform();
        this.zoomTransform = {
            ...transform,
            translateX: transform.translateX + dx,
            translateY: transform.translateY + dy
        };
        this.render();
    }
    
    resetZoom() {
        this.zoomTransform = { scale: 1, translateX: 0, translateY: 0 };
        this.render();
    }
    
    centerView() {
        if (!this.graphData || !this.graphData.nodes || this.graphData.nodes.length === 0) {
            return;
        }
        
        const nodes = this.graphData.nodes;
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        nodes.forEach(node => {
            minX = Math.min(minX, node.x);
            maxX = Math.max(maxX, node.x);
            minY = Math.min(minY, node.y);
            maxY = Math.max(maxY, node.y);
        });
        
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        
        const rect = this.canvas.getBoundingClientRect();
        const width = maxX - minX + 100;
        const height = maxY - minY + 100;
        
        const scaleX = (rect.width - 40) / width;
        const scaleY = (rect.height - 40) / height;
        const scale = Math.min(scaleX, scaleY, 2);
        
        this.zoomTransform = {
            scale: scale,
            translateX: rect.width / 2 - centerX * scale,
            translateY: rect.height / 2 - centerY * scale
        };
        
        this.render();
    }
    
    togglePause() {
        this.isPaused = !this.isPaused;
        const btn = document.getElementById('btn-pause');
        btn.textContent = this.isPaused ? '▶️' : '⏸️';
        btn.title = this.isPaused ? '继续模拟' : '暂停模拟';
        
        if (this.simulation) {
            if (this.isPaused) {
                this.simulation.stop();
            } else {
                this.simulation.alpha(0.3).restart();
            }
        }
    }
    
    handleFileSelect(file) {
        this.selectedFile = file;
        document.getElementById('file-name').textContent = file.name;
        document.getElementById('file-info').style.display = 'flex';
        document.getElementById('btn-upload').disabled = false;
    }
    
    clearFile() {
        this.selectedFile = null;
        document.getElementById('file-input').value = '';
        document.getElementById('file-info').style.display = 'none';
        document.getElementById('btn-upload').disabled = true;
    }
    
    async uploadFile() {
        if (!this.selectedFile) return;
        
        this.showLoading();
        
        const formData = new FormData();
        formData.append('file', this.selectedFile);
        
        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.graphData = result;
                this.initializeGraph();
                this.hideWelcomeMessage();
                this.showStatistics();
                this.showCommunityList();
                this.showLLMPanel();
            } else {
                alert('上传失败: ' + result.error);
            }
        } catch (error) {
            console.error('Upload error:', error);
            alert('上传失败: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }
    
    initializeGraph() {
        if (!this.graphData || !this.graphData.nodes) return;
        
        const communities = [...new Set(this.graphData.nodes.map(n => n.community))];
        this.colorScale.domain(communities);
        
        this.graphData.nodes.forEach(node => {
            this.communityColors[node.community] = this.colorScale(node.community);
        });
        
        const rect = this.canvas.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        this.graphData.nodes.forEach((node, i) => {
            if (node.x === undefined) {
                const angle = (i / this.graphData.nodes.length) * Math.PI * 2;
                const radius = 100 + Math.random() * 100;
                node.x = centerX + Math.cos(angle) * radius;
                node.y = centerY + Math.sin(angle) * radius;
            }
            node.vx = 0;
            node.vy = 0;
        });
        
        this.nodeMap = new Map();
        this.graphData.nodes.forEach(node => {
            this.nodeMap.set(node.id, node);
        });
        
        this.graphData.links.forEach(link => {
            if (typeof link.source === 'string') {
                link.source = this.nodeMap.get(link.source);
                link.target = this.nodeMap.get(link.target);
            }
        });
        
        this.adjacencyList = new Map();
        this.graphData.nodes.forEach(node => {
            this.adjacencyList.set(node.id, []);
        });
        
        this.graphData.links.forEach(link => {
            if (link.source && link.target) {
                this.adjacencyList.get(link.source.id).push(link.target.id);
                this.adjacencyList.get(link.target.id).push(link.source.id);
            }
        });
        
        if (this.simulation) {
            this.simulation.stop();
        }
        
        this.simulation = d3.forceSimulation(this.graphData.nodes)
            .force('link', d3.forceLink(this.graphData.links).id(d => d.id).distance(80))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('center', d3.forceCenter(centerX, centerY))
            .force('collision', d3.forceCollide().radius(d => this.getNodeRadius(d) + 2))
            .on('tick', () => this.render());
        
        this.render();
    }
    
    getNodeRadius(node) {
        const connections = this.adjacencyList.get(node.id);
        const degree = connections ? connections.length : 1;
        return Math.max(4, Math.min(20, 4 + Math.sqrt(degree) * 2));
    }
    
    render() {
        if (!this.gl || !this.graphData || !this.graphData.nodes) return;
        
        const gl = this.gl;
        const transform = this.getCurrentTransform();
        const rect = this.canvas.getBoundingClientRect();
        
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0.97, 0.98, 0.99, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        
        gl.useProgram(this.program);
        
        gl.uniform2f(this.resolutionLocation, rect.width, rect.height);
        
        const identityMatrix = new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ]);
        gl.uniformMatrix4fv(this.matrixLocation, false, identityMatrix);
        
        const positions = [];
        const colors = [];
        const sizes = [];
        const isNodes = [];
        
        if (this.showEdges && this.graphData.links) {
            this.graphData.links.forEach(link => {
                if (!link.source || !link.target) return;
                
                const sx = link.source.x * transform.scale + transform.translateX;
                const sy = link.source.y * transform.scale + transform.translateY;
                const tx = link.target.x * transform.scale + transform.translateX;
                const ty = link.target.y * transform.scale + transform.translateY;
                
                let isHighlighted = false;
                let opacity = 0.7;
                
                if (this.selectedNode) {
                    if (this.highlightedEdges.has(link)) {
                        isHighlighted = true;
                        opacity = 1.0;
                    } else {
                        opacity = 0.6;
                    }
                }
                
                const edgeColor = isHighlighted ? 
                    this.parseColor('#fbbf24', opacity) : 
                    this.parseColor('#64748b', opacity);
                
                positions.push(sx, sy, tx, ty);
                colors.push(...edgeColor, ...edgeColor);
                sizes.push(1, 1);
                isNodes.push(0, 0);
            });
        }
        
        if (positions.length > 0) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(this.positionLocation);
            gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
            
            gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(this.colorLocation);
            gl.vertexAttribPointer(this.colorLocation, 4, gl.FLOAT, false, 0, 0);
            
            gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sizes), gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(this.sizeLocation);
            gl.vertexAttribPointer(this.sizeLocation, 1, gl.FLOAT, false, 0, 0);
            
            gl.bindBuffer(gl.ARRAY_BUFFER, this.isNodeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(isNodes), gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(this.isNodeLocation);
            gl.vertexAttribPointer(this.isNodeLocation, 1, gl.FLOAT, false, 0, 0);
            
            gl.drawArrays(gl.LINES, 0, positions.length / 2);
        }
        
        const nodePositions = [];
        const nodeColors = [];
        const nodeSizes = [];
        const nodeIsNodes = [];
        
        this.graphData.nodes.forEach(node => {
            const x = node.x * transform.scale + transform.translateX;
            const y = node.y * transform.scale + transform.translateY;
            const radius = this.getNodeRadius(node) * transform.scale;
            
            let opacity = 1.0;
            let color = this.communityColors[node.community] || '#667eea';
            
            if (this.selectedNode) {
                if (this.highlightedNodes.has(node.id)) {
                    opacity = 1.0;
                    if (node.id === this.selectedNode.id) {
                        color = '#fbbf24';
                    }
                } else {
                    opacity = 0.7;
                }
            }
            
            const rgba = this.parseColor(color, opacity);
            
            nodePositions.push(x, y);
            nodeColors.push(...rgba);
            nodeSizes.push(radius);
            nodeIsNodes.push(1);
        });
        
        if (nodePositions.length > 0) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nodePositions), gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(this.positionLocation);
            gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
            
            gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nodeColors), gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(this.colorLocation);
            gl.vertexAttribPointer(this.colorLocation, 4, gl.FLOAT, false, 0, 0);
            
            gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nodeSizes), gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(this.sizeLocation);
            gl.vertexAttribPointer(this.sizeLocation, 1, gl.FLOAT, false, 0, 0);
            
            gl.bindBuffer(gl.ARRAY_BUFFER, this.isNodeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nodeIsNodes), gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(this.isNodeLocation);
            gl.vertexAttribPointer(this.isNodeLocation, 1, gl.FLOAT, false, 0, 0);
            
            gl.drawArrays(gl.POINTS, 0, nodePositions.length / 2);
        }
        
        this.renderLabels();
    }
    
    renderLabels() {
        this.svg.selectAll('*').remove();
        
        if (!this.showLabels || !this.graphData || !this.graphData.nodes) return;
        
        const transform = this.getCurrentTransform();
        const node = this.selectedNode;
        
        if (node) {
            const x = node.x * transform.scale + transform.translateX;
            const y = node.y * transform.scale + transform.translateY;
            const radius = (this.getNodeRadius(node) + 4) * transform.scale;
            
            this.svg.append('circle')
                .attr('class', 'clickable')
                .attr('cx', x)
                .attr('cy', y)
                .attr('r', radius)
                .attr('fill', 'none')
                .attr('stroke', '#f59e0b')
                .attr('stroke-width', 3);
        }
        
        if (transform.scale > 0.5 && node) {
            const x = node.x * transform.scale + transform.translateX;
            const y = node.y * transform.scale + transform.translateY;
            const radius = this.getNodeRadius(node) * transform.scale;
            
            const text = this.svg.append('text')
                .attr('x', x)
                .attr('y', y - radius - 8)
                .attr('text-anchor', 'middle')
                .attr('font-size', 12 * transform.scale)
                .attr('font-weight', 'bold')
                .attr('fill', '#1e293b')
                .text(node.id);
            
            const bbox = text.node().getBBox();
            this.svg.insert('rect', 'text')
                .attr('x', bbox.x - 4)
                .attr('y', bbox.y - 2)
                .attr('width', bbox.width + 8)
                .attr('height', bbox.height + 4)
                .attr('fill', 'white')
                .attr('opacity', 0.9)
                .attr('rx', 4);
        }
        
        if (transform.scale > 0.7) {
            this.graphData.nodes.forEach(node => {
                if (this.selectedNode && !this.highlightedNodes.has(node.id)) return;
                if (node === this.selectedNode) return;
                
                const x = node.x * transform.scale + transform.translateX;
                const y = node.y * transform.scale + transform.translateY;
                const radius = this.getNodeRadius(node) * transform.scale;
                
                this.svg.append('text')
                    .attr('x', x)
                    .attr('y', y - radius - 5)
                    .attr('text-anchor', 'middle')
                    .attr('font-size', Math.max(8, 10 * transform.scale))
                    .attr('fill', '#475569')
                    .text(node.id);
            });
        }
    }
    
    parseColor(color, alpha = 1.0) {
        if (color.startsWith('#')) {
            const hex = color.slice(1);
            const r = parseInt(hex.substring(0, 2), 16) / 255;
            const g = parseInt(hex.substring(2, 4), 16) / 255;
            const b = parseInt(hex.substring(4, 6), 16) / 255;
            return [r, g, b, alpha];
        }
        return [0.4, 0.5, 0.6, alpha];
    }
    
    selectNode(node) {
        this.selectedNode = node;
        
        this.highlightedNodes = new Set([node.id]);
        this.highlightedEdges = new Set();
        
        const neighbors = this.adjacencyList.get(node.id) || [];
        neighbors.forEach(neighborId => {
            this.highlightedNodes.add(neighborId);
        });
        
        this.graphData.links.forEach(link => {
            if (!link.source || !link.target) return;
            
            const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
            const targetId = typeof link.target === 'object' ? link.target.id : link.target;
            
            if (sourceId === node.id || targetId === node.id) {
                this.highlightedEdges.add(link);
            }
        });
        
        this.showNodeInfo(node);
        this.render();
    }
    
    showNodeInfo(node) {
        const panel = document.getElementById('node-info-panel');
        const content = document.getElementById('node-info-content');
        
        let html = `
            <div class="node-property">
                <div class="node-property-key">ID</div>
                <div class="node-property-value">${node.id}</div>
            </div>
            <div class="node-property">
                <div class="node-property-key">Community</div>
                <div class="node-property-value">${node.community}</div>
            </div>
            <div class="node-property">
                <div class="node-property-key">Degree</div>
                <div class="node-property-value">${(this.adjacencyList.get(node.id) || []).length}</div>
            </div>
        `;
        
        if (node.properties) {
            Object.keys(node.properties).forEach(key => {
                html += `
                    <div class="node-property">
                        <div class="node-property-key">${key}</div>
                        <div class="node-property-value">${node.properties[key]}</div>
                    </div>
                `;
            });
        }
        
        const neighbors = this.adjacencyList.get(node.id) || [];
        if (neighbors.length > 0) {
            html += `
                <div class="node-property">
                    <div class="node-property-key">相关节点</div>
                    <div class="node-property-value">
                        <button id="btn-drill-down" class="btn btn-small btn-primary" style="margin-top: 8px;">
                            探索局部网络
                        </button>
                    </div>
                </div>
            `;
        }
        
        content.innerHTML = html;
        panel.style.display = 'block';
        
        const drillBtn = document.getElementById('btn-drill-down');
        if (drillBtn) {
            drillBtn.addEventListener('click', () => this.drillDown(node));
        }
    }
    
    hideNodeInfo() {
        this.selectedNode = null;
        this.highlightedNodes = new Set();
        this.highlightedEdges = new Set();
        document.getElementById('node-info-panel').style.display = 'none';
        this.render();
    }
    
    drillDown(node) {
        if (!this.graphData) return;
        
        const neighbors = this.adjacencyList.get(node.id) || [];
        
        const visibleNodes = new Set([node.id]);
        neighbors.forEach(n => visibleNodes.add(n));
        
        const originalNodes = [...this.graphData.nodes];
        const originalLinks = [...this.graphData.links];
        
        if (!this.hiddenData) {
            this.hiddenData = {
                nodes: [...originalNodes],
                links: [...originalLinks]
            };
        }
        
        this.graphData.nodes = originalNodes.filter(n => visibleNodes.has(n.id));
        this.graphData.links = originalLinks.filter(link => {
            if (!link.source || !link.target) return false;
            
            const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
            const targetId = typeof link.target === 'object' ? link.target.id : link.target;
            
            return visibleNodes.has(sourceId) && visibleNodes.has(targetId);
        });
        
        this.graphData.statistics = {
            nodeCount: this.graphData.nodes.length,
            linkCount: this.graphData.links.length,
            communityCount: [...new Set(this.graphData.nodes.map(n => n.community))].length
        };
        
        this.showStatistics();
        
        if (this.simulation) {
            this.simulation.stop();
        }
        
        this.initializeGraph();
        this.centerView();
        this.hideNodeInfo();
    }
    
    showLoading() {
        document.getElementById('loading-overlay').style.display = 'flex';
    }
    
    hideLoading() {
        document.getElementById('loading-overlay').style.display = 'none';
    }
    
    hideWelcomeMessage() {
        document.getElementById('welcome-message').style.display = 'none';
    }
    
    showStatistics() {
        const panel = document.getElementById('statistics-panel');
        const stats = this.graphData.statistics;
        
        document.getElementById('stat-nodes').textContent = stats.nodeCount;
        document.getElementById('stat-edges').textContent = stats.linkCount;
        document.getElementById('stat-communities').textContent = stats.communityCount;
        
        panel.style.display = 'block';
    }
    
    showCommunityList() {
        const panel = document.getElementById('community-panel');
        const list = document.getElementById('community-list');
        
        const communityCounts = {};
        this.graphData.nodes.forEach(node => {
            communityCounts[node.community] = (communityCounts[node.community] || 0) + 1;
        });
        
        const communities = Object.keys(communityCounts).sort((a, b) => 
            communityCounts[b] - communityCounts[a]
        );
        
        let html = '';
        communities.forEach(comm => {
            const color = this.communityColors[comm];
            const count = communityCounts[comm];
            
            html += `
                <div class="community-item" data-community="${comm}">
                    <div class="community-color" style="background-color: ${color}"></div>
                    <div class="community-name">Community ${comm}</div>
                    <div class="community-count">${count} 节点</div>
                </div>
            `;
        });
        
        list.innerHTML = html;
        panel.style.display = 'block';
        
        list.querySelectorAll('.community-item').forEach(item => {
            item.addEventListener('click', () => {
                const community = item.dataset.community;
                this.highlightCommunity(community);
            });
        });
    }
    
    highlightCommunity(communityId) {
        if (!this.graphData) return;
        
        this.highlightedNodes = new Set();
        this.highlightedEdges = new Set();
        
        this.graphData.nodes.forEach(node => {
            if (node.community == communityId) {
                this.highlightedNodes.add(node.id);
            }
        });
        
        this.selectedNode = null;
        
        this.graphData.links.forEach(link => {
            if (!link.source || !link.target) return;
            
            const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
            const targetId = typeof link.target === 'object' ? link.target.id : link.target;
            
            if (this.highlightedNodes.has(sourceId) && this.highlightedNodes.has(targetId)) {
                this.highlightedEdges.add(link);
            }
        });
        
        this.render();
    }
    
    showLLMPanel() {
        const panel = document.getElementById('llm-panel');
        const btn = document.getElementById('btn-llm-analyze');
        
        if (this.llmConfig.baseUrl && this.llmConfig.apiKey) {
            btn.disabled = false;
        }
        
        panel.style.display = 'block';
    }
    
    showSettingsModal() {
        const modal = document.getElementById('settings-modal');
        
        document.getElementById('setting-baseurl').value = this.llmConfig.baseUrl || '';
        document.getElementById('setting-apikey').value = this.llmConfig.apiKey || '';
        document.getElementById('setting-model').value = this.llmConfig.modelName || '';
        
        modal.style.display = 'flex';
    }
    
    hideSettingsModal() {
        document.getElementById('settings-modal').style.display = 'none';
        document.getElementById('test-result').style.display = 'none';
    }
    
    loadLLMConfig() {
        const saved = localStorage.getItem('llmConfig');
        return saved ? JSON.parse(saved) : {};
    }
    
    saveLLMConfig() {
        const config = {
            baseUrl: document.getElementById('setting-baseurl').value.trim(),
            apiKey: document.getElementById('setting-apikey').value.trim(),
            modelName: document.getElementById('setting-model').value.trim()
        };
        
        localStorage.setItem('llmConfig', JSON.stringify(config));
        this.llmConfig = config;
        
        const btn = document.getElementById('btn-llm-analyze');
        if (config.baseUrl && config.apiKey) {
            btn.disabled = false;
        }
        
        this.hideSettingsModal();
    }
    
    async testLLMConnection() {
        const resultDiv = document.getElementById('test-result');
        
        const config = {
            baseUrl: document.getElementById('setting-baseurl').value.trim(),
            apiKey: document.getElementById('setting-apikey').value.trim(),
            modelName: document.getElementById('setting-model').value.trim()
        };
        
        if (!config.baseUrl || !config.apiKey) {
            resultDiv.className = 'test-result error';
            resultDiv.textContent = '请填写 Base URL 和 API Key';
            resultDiv.style.display = 'block';
            return;
        }
        
        resultDiv.textContent = '正在测试连接...';
        resultDiv.className = 'test-result';
        resultDiv.style.display = 'block';
        
        try {
            const response = await fetch('/api/llm/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            
            const result = await response.json();
            
            if (result.success) {
                resultDiv.className = 'test-result success';
                resultDiv.textContent = '✓ 连接成功: ' + result.message;
            } else {
                resultDiv.className = 'test-result error';
                resultDiv.textContent = '✗ 连接失败: ' + result.message;
            }
        } catch (error) {
            resultDiv.className = 'test-result error';
            resultDiv.textContent = '✗ 请求失败: ' + error.message;
        }
    }
    
    async runLLMAnalysis() {
        if (!this.graphData || !this.llmConfig.baseUrl || !this.llmConfig.apiKey) {
            return;
        }
        
        const prompt = document.getElementById('llm-prompt').value.trim();
        const resultDiv = document.getElementById('llm-result');
        const btn = document.getElementById('btn-llm-analyze');
        
        if (!prompt) {
            alert('请输入分析问题');
            return;
        }
        
        btn.disabled = true;
        btn.textContent = '分析中...';
        
        try {
            const response = await fetch('/api/llm/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...this.llmConfig,
                    graphData: this.graphData,
                    prompt: prompt
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                resultDiv.innerHTML = this.formatMarkdown(result.content);
                resultDiv.style.display = 'block';
            } else {
                alert('分析失败: ' + (result.error || '未知错误'));
            }
        } catch (error) {
            console.error('LLM analysis error:', error);
            alert('分析失败: ' + error.message);
        } finally {
            btn.disabled = false;
            btn.textContent = '智能分析';
        }
    }
    
    formatMarkdown(text) {
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new TopoVisApp();
});
