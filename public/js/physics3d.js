class Physics3DEngine {
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.raycaster = null;
        this.mouse = null;
        
        this.nodes = new Map();
        this.nodeMeshes = new Map();
        this.nodeLabels = new Map();
        this.links = [];
        this.linkMeshes = [];
        
        this.graphData = null;
        this.isPhysicsEnabled = true;
        this.isPaused = false;
        this.animationId = null;
        
        this.velocity = new Map();
        this.acceleration = new Map();
        
        this.damping = 0.98;
        this.springForce = 0.01;
        this.repulsionForce = 500;
        this.centerForce = 0.001;
        this.linkRestLength = 150;
        
        this.selectedNode = null;
        this.hoveredNode = null;
        this.draggingNode = null;
        
        this.collisionRadius = 30;
        this.collisionForce = 0.5;
        
        this.communityColors = {};
        this.colorScale = d3.scaleOrdinal()
            .range([
                '#ef4444', '#f97316', '#eab308', '#22c55e', 
                '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
                '#06b6d4', '#f59e0b', '#84cc16', '#6366f1',
                '#a855f7', '#d946ef', '#0ea5e9', '#10b981'
            ]);
        
        this.onNodeClick = null;
        this.onNodeHover = null;
        this.onNodeDrag = null;
        
        this.init();
    }
    
    init() {
        this.createScene();
        this.createCamera();
        this.createRenderer();
        this.createControls();
        this.createLights();
        this.createHelpers();
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.setupEventListeners();
        this.animate();
    }
    
    createScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf1f5f9);
        this.scene.fog = new THREE.Fog(0xf1f5f9, 500, 2000);
    }
    
    createCamera() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        
        this.camera = new THREE.PerspectiveCamera(
            60,
            width / height,
            0.1,
            5000
        );
        this.camera.position.set(0, 300, 500);
    }
    
    createRenderer() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        
        this.renderer = new THREE.WebGLRenderer({
            canvas: document.getElementById('three-canvas'),
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    
    createControls() {
        this.controls = new THREE.OrbitControls(
            this.camera,
            this.renderer.domElement
        );
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.enablePan = true;
        this.controls.enableZoom = true;
        this.controls.enableRotate = true;
        this.controls.minDistance = 100;
        this.controls.maxDistance = 2000;
        this.controls.autoRotate = false;
        this.controls.autoRotateSpeed = 0.5;
    }
    
    createLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
        mainLight.position.set(100, 200, 100);
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.width = 2048;
        mainLight.shadow.mapSize.height = 2048;
        mainLight.shadow.camera.near = 0.5;
        mainLight.shadow.camera.far = 1000;
        mainLight.shadow.camera.left = -500;
        mainLight.shadow.camera.right = 500;
        mainLight.shadow.camera.top = 500;
        mainLight.shadow.camera.bottom = -500;
        this.scene.add(mainLight);
        
        const fillLight = new THREE.DirectionalLight(0x60a5fa, 0.3);
        fillLight.position.set(-100, 100, -100);
        this.scene.add(fillLight);
        
        const rimLight = new THREE.DirectionalLight(0xf472b6, 0.2);
        rimLight.position.set(0, -100, -100);
        this.scene.add(rimLight);
    }
    
    createHelpers() {
        const gridHelper = new THREE.GridHelper(1000, 50, 0xe2e8f0, 0xf1f5f9);
        gridHelper.position.y = -50;
        this.scene.add(gridHelper);
    }
    
    setupEventListeners() {
        const canvas = this.renderer.domElement;
        
        window.addEventListener('resize', () => this.onResize());
        
        canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    
    onResize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    
    onMouseDown(e) {
        this.updateMouse(e);
        const intersects = this.getIntersects();
        
        if (intersects.length > 0) {
            const mesh = intersects[0].object;
            const nodeId = mesh.userData.nodeId;
            
            if (nodeId && this.nodes.has(nodeId)) {
                this.draggingNode = nodeId;
                this.controls.enabled = false;
                
                if (this.onNodeClick) {
                    this.onNodeClick(nodeId, this.nodes.get(nodeId));
                }
            }
        }
    }
    
    onMouseMove(e) {
        this.updateMouse(e);
        const intersects = this.getIntersects();
        
        this.renderer.domElement.style.cursor = 'default';
        
        if (this.draggingNode) {
            const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
            const raycaster = this.raycaster;
            const intersection = new THREE.Vector3();
            
            raycaster.ray.intersectPlane(plane, intersection);
            
            if (intersection) {
                const node = this.nodes.get(this.draggingNode);
                if (node) {
                    node.position.copy(intersection);
                    this.velocity.set(this.draggingNode, new THREE.Vector3(0, 0, 0));
                }
            }
        } else {
            if (intersects.length > 0) {
                const mesh = intersects[0].object;
                const nodeId = mesh.userData.nodeId;
                
                if (nodeId) {
                    this.renderer.domElement.style.cursor = 'pointer';
                    
                    if (this.hoveredNode !== nodeId) {
                        if (this.hoveredNode && this.nodeMeshes.has(this.hoveredNode)) {
                            this.resetNodeScale(this.hoveredNode);
                        }
                        
                        this.hoveredNode = nodeId;
                        this.highlightNode(nodeId);
                        
                        if (this.onNodeHover) {
                            this.onNodeHover(nodeId, this.nodes.get(nodeId));
                        }
                    }
                }
            } else {
                if (this.hoveredNode) {
                    if (this.nodeMeshes.has(this.hoveredNode)) {
                        this.resetNodeScale(this.hoveredNode);
                    }
                    this.hoveredNode = null;
                    
                    if (this.onNodeHover) {
                        this.onNodeHover(null, null);
                    }
                }
            }
        }
    }
    
    onMouseUp(e) {
        if (this.draggingNode) {
            this.draggingNode = null;
            this.controls.enabled = true;
        }
    }
    
    onWheel(e) {
        if (this.isTimelineScrollMode) {
            e.preventDefault();
            e.stopPropagation();
            if (this.onTimelineScroll) {
                this.onTimelineScroll(e.deltaY);
            }
        }
    }
    
    updateMouse(e) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }
    
    getIntersects() {
        const meshes = [];
        this.nodeMeshes.forEach((mesh) => {
            meshes.push(mesh);
        });
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        return this.raycaster.intersectObjects(meshes, false);
    }
    
    setGraphData(graphData) {
        this.graphData = graphData;
        this.clearScene();
        this.initializeNodes();
        this.initializeLinks();
        
        document.getElementById('timeline-container').style.display = 'block';
        document.getElementById('mode-indicator').style.display = 'flex';
    }
    
    clearScene() {
        this.nodeMeshes.forEach((mesh) => {
            this.scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
        });
        this.nodeMeshes.clear();
        
        this.linkMeshes.forEach((mesh) => {
            this.scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
        });
        this.linkMeshes = [];
        
        this.nodes.clear();
        this.velocity.clear();
        this.acceleration.clear();
        this.links = [];
    }
    
    initializeNodes() {
        if (!this.graphData || !this.graphData.nodes) return;
        
        const communities = [...new Set(this.graphData.nodes.map(n => n.community))];
        this.colorScale.domain(communities);
        
        this.graphData.nodes.forEach(node => {
            this.communityColors[node.community] = this.colorScale(node.community);
        });
        
        this.graphData.nodes.forEach((node, i) => {
            const angle = (i / this.graphData.nodes.length) * Math.PI * 2;
            const radius = 100 + Math.random() * 200;
            
            const position = new THREE.Vector3(
                Math.cos(angle) * radius,
                (Math.random() - 0.5) * 100,
                Math.sin(angle) * radius
            );
            
            this.nodes.set(node.id, {
                id: node.id,
                data: node,
                position: position,
                velocity: new THREE.Vector3(0, 0, 0),
                community: node.community,
                degree: this.getNodeDegree(node.id)
            });
            
            this.velocity.set(node.id, new THREE.Vector3(0, 0, 0));
            this.acceleration.set(node.id, new THREE.Vector3(0, 0, 0));
            
            this.createNodeMesh(node.id, node.community);
        });
    }
    
    getNodeDegree(nodeId) {
        if (!this.graphData || !this.graphData.links) return 0;
        
        let degree = 0;
        this.graphData.links.forEach(link => {
            const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
            const targetId = typeof link.target === 'object' ? link.target.id : link.target;
            
            if (sourceId === nodeId || targetId === nodeId) {
                degree++;
            }
        });
        
        return degree;
    }
    
    createNodeMesh(nodeId, community) {
        const node = this.nodes.get(nodeId);
        if (!node) return;
        
        const degree = node.degree;
        const radius = Math.max(8, Math.min(30, 8 + Math.sqrt(degree) * 3));
        
        const color = this.communityColors[community] || '#667eea';
        
        const geometry = new THREE.IcosahedronGeometry(radius, 2);
        
        const material = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(color),
            metalness: 0.3,
            roughness: 0.4,
            clearcoat: 0.3,
            clearcoatRoughness: 0.2,
            emissive: new THREE.Color(color),
            emissiveIntensity: 0.1,
            transparent: true,
            opacity: 0.95
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(node.position);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.nodeId = nodeId;
        
        const ringGeometry = new THREE.RingGeometry(radius + 2, radius + 4, 32);
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = Math.PI / 2;
        ring.userData.nodeId = nodeId;
        
        const glowGeometry = new THREE.SphereGeometry(radius * 1.5, 32, 32);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: 0.1,
            side: THREE.BackSide
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        glow.userData.nodeId = nodeId;
        
        const group = new THREE.Group();
        group.add(mesh);
        group.add(ring);
        group.add(glow);
        group.position.copy(node.position);
        group.userData.nodeId = nodeId;
        group.userData.mainMesh = mesh;
        group.userData.ring = ring;
        group.userData.glow = glow;
        group.userData.radius = radius;
        group.userData.originalScale = 1;
        
        this.scene.add(group);
        this.nodeMeshes.set(nodeId, group);
    }
    
    initializeLinks() {
        if (!this.graphData || !this.graphData.links) return;
        
        this.links = [];
        
        this.graphData.links.forEach((link, index) => {
            let sourceId, targetId;
            
            if (typeof link.source === 'object') {
                sourceId = link.source.id;
                targetId = link.target.id;
            } else {
                sourceId = link.source;
                targetId = link.target;
            }
            
            if (this.nodes.has(sourceId) && this.nodes.has(targetId)) {
                this.links.push({
                    sourceId,
                    targetId,
                    data: link,
                    index
                });
                
                this.createLinkMesh(sourceId, targetId, link);
            }
        });
    }
    
    createLinkMesh(sourceId, targetId, linkData) {
        const source = this.nodes.get(sourceId);
        const target = this.nodes.get(targetId);
        
        if (!source || !target) return;
        
        const curve = new THREE.LineCurve3(
            source.position.clone(),
            target.position.clone()
        );
        
        const tubeGeometry = new THREE.TubeGeometry(curve, 8, 0.5, 4, false);
        
        const sourceCommunity = source.community;
        const targetCommunity = target.community;
        
        let color = '#94a3b8';
        if (sourceCommunity === targetCommunity) {
            color = this.communityColors[sourceCommunity] || '#94a3b8';
        }
        
        const material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: 0.6
        });
        
        const mesh = new THREE.Mesh(tubeGeometry, material);
        mesh.userData.sourceId = sourceId;
        mesh.userData.targetId = targetId;
        
        this.scene.add(mesh);
        this.linkMeshes.push(mesh);
    }
    
    updateLinkMeshes() {
        this.linkMeshes.forEach((mesh, index) => {
            const link = this.links[index];
            if (!link) return;
            
            const source = this.nodes.get(link.sourceId);
            const target = this.nodes.get(link.targetId);
            
            if (!source || !target) return;
            
            const positions = mesh.geometry.attributes.position;
            const pointCount = positions.count;
            
            for (let i = 0; i < pointCount; i++) {
                const t = i / (pointCount - 1);
                const pos = new THREE.Vector3().lerpVectors(
                    source.position,
                    target.position,
                    t
                );
                positions.setXYZ(i, pos.x, pos.y, pos.z);
            }
            
            positions.needsUpdate = true;
        });
    }
    
    highlightNode(nodeId) {
        const group = this.nodeMeshes.get(nodeId);
        if (!group) return;
        
        group.scale.setScalar(1.2);
        
        if (group.userData.mainMesh) {
            group.userData.mainMesh.material.emissiveIntensity = 0.5;
        }
    }
    
    resetNodeScale(nodeId) {
        const group = this.nodeMeshes.get(nodeId);
        if (!group) return;
        
        group.scale.setScalar(1);
        
        if (group.userData.mainMesh) {
            group.userData.mainMesh.material.emissiveIntensity = 0.1;
        }
    }
    
    setSelectedNode(nodeId) {
        if (this.selectedNode) {
            this.resetNodeScale(this.selectedNode);
        }
        
        this.selectedNode = nodeId;
        
        if (nodeId) {
            this.highlightNode(nodeId);
        }
    }
    
    updatePhysics() {
        if (!this.isPhysicsEnabled || this.isPaused) return;
        
        const nodeArray = Array.from(this.nodes.values());
        
        nodeArray.forEach(node => {
            if (node.id === this.draggingNode) return;
            
            const acceleration = new THREE.Vector3(0, 0, 0);
            
            nodeArray.forEach(otherNode => {
                if (node.id === otherNode.id) return;
                
                const diff = new THREE.Vector3().subVectors(node.position, otherNode.position);
                const distance = diff.length() || 0.1;
                
                if (distance < this.collisionRadius * 2) {
                    const repulsion = this.repulsionForce / (distance * distance);
                    diff.normalize().multiplyScalar(repulsion);
                    acceleration.add(diff);
                }
            });
            
            this.links.forEach(link => {
                let other = null;
                
                if (link.sourceId === node.id) {
                    other = this.nodes.get(link.targetId);
                } else if (link.targetId === node.id) {
                    other = this.nodes.get(link.sourceId);
                }
                
                if (other) {
                    const diff = new THREE.Vector3().subVectors(other.position, node.position);
                    const distance = diff.length() || 0.1;
                    
                    const stretch = distance - this.linkRestLength;
                    if (Math.abs(stretch) > 0.1) {
                        diff.normalize().multiplyScalar(stretch * this.springForce);
                        acceleration.add(diff);
                    }
                }
            });
            
            const centerForce = new THREE.Vector3(0, 0, 0).sub(node.position);
            centerForce.multiplyScalar(this.centerForce);
            acceleration.add(centerForce);
            
            const velocity = this.velocity.get(node.id) || new THREE.Vector3(0, 0, 0);
            velocity.add(acceleration);
            velocity.multiplyScalar(this.damping);
            
            node.position.add(velocity);
            this.velocity.set(node.id, velocity);
            
            const meshGroup = this.nodeMeshes.get(node.id);
            if (meshGroup) {
                meshGroup.position.copy(node.position);
                
                const rotationSpeed = 0.01 * (velocity.length() + 0.1);
                meshGroup.rotation.x += rotationSpeed;
                meshGroup.rotation.y += rotationSpeed * 0.7;
            }
        });
        
        this.updateLinkMeshes();
    }
    
    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());
        
        this.updatePhysics();
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
    
    zoomIn() {
        this.camera.position.multiplyScalar(0.9);
    }
    
    zoomOut() {
        this.camera.position.multiplyScalar(1.1);
    }
    
    resetZoom() {
        this.camera.position.set(0, 300, 500);
        this.controls.reset();
    }
    
    centerView() {
        if (this.nodes.size === 0) return;
        
        let center = new THREE.Vector3(0, 0, 0);
        this.nodes.forEach(node => {
            center.add(node.position);
        });
        center.divideScalar(this.nodes.size);
        
        this.camera.position.set(
            center.x,
            center.y + 300,
            center.z + 500
        );
        this.controls.target.copy(center);
    }
    
    togglePause() {
        this.isPaused = !this.isPaused;
        return this.isPaused;
    }
    
    togglePhysics() {
        this.isPhysicsEnabled = !this.isPhysicsEnabled;
        return this.isPhysicsEnabled;
    }
    
    getState() {
        const state = {
            nodes: [],
            links: [],
            timestamp: Date.now(),
            removedNodes: []
        };
        
        this.nodes.forEach((node, id) => {
            state.nodes.push({
                id: node.id,
                position: {
                    x: node.position.x,
                    y: node.position.y,
                    z: node.position.z
                },
                velocity: {
                    x: node.velocity.x,
                    y: node.velocity.y,
                    z: node.velocity.z
                },
                community: node.community,
                degree: node.degree
            });
        });
        
        this.links.forEach(link => {
            state.links.push({
                sourceId: link.sourceId,
                targetId: link.targetId
            });
        });
        
        return state;
    }
    
    restoreState(state) {
        if (!state || !state.nodes) return;
        
        state.nodes.forEach(nodeState => {
            const node = this.nodes.get(nodeState.id);
            if (node) {
                node.position.set(
                    nodeState.position.x,
                    nodeState.position.y,
                    nodeState.position.z
                );
                node.velocity.set(
                    nodeState.velocity.x,
                    nodeState.velocity.y,
                    nodeState.velocity.z
                );
                
                this.velocity.set(nodeState.id, node.velocity.clone());
                
                const meshGroup = this.nodeMeshes.get(nodeState.id);
                if (meshGroup) {
                    meshGroup.position.copy(node.position);
                    meshGroup.visible = true;
                }
            }
        });
        
        this.linkMeshes.forEach(mesh => {
            mesh.visible = true;
        });
        
        this.updateLinkMeshes();
    }
    
    removeNode(nodeId, animate = true) {
        const node = this.nodes.get(nodeId);
        if (!node) return;
        
        const meshGroup = this.nodeMeshes.get(nodeId);
        if (meshGroup) {
            if (animate) {
                const collapseAnimation = () => {
                    meshGroup.scale.multiplyScalar(0.95);
                    meshGroup.rotation.x += 0.1;
                    meshGroup.rotation.y += 0.1;
                    
                    if (meshGroup.scale.x > 0.01) {
                        requestAnimationFrame(collapseAnimation);
                    } else {
                        meshGroup.visible = false;
                    }
                };
                collapseAnimation();
            } else {
                meshGroup.visible = false;
            }
        }
        
        this.links.forEach((link, index) => {
            if (link.sourceId === nodeId || link.targetId === nodeId) {
                if (this.linkMeshes[index]) {
                    this.linkMeshes[index].visible = false;
                }
            }
        });
    }
    
    restoreNode(nodeId) {
        const meshGroup = this.nodeMeshes.get(nodeId);
        if (meshGroup) {
            meshGroup.visible = true;
            meshGroup.scale.setScalar(1);
        }
    }
    
    getNodeData(nodeId) {
        return this.nodes.get(nodeId);
    }
    
    getAdjacentNodes(nodeId) {
        const adjacent = [];
        
        this.links.forEach(link => {
            if (link.sourceId === nodeId) {
                adjacent.push(link.targetId);
            } else if (link.targetId === nodeId) {
                adjacent.push(link.sourceId);
            }
        });
        
        return adjacent;
    }
    
    setLinkOpacity(opacity) {
        this.linkMeshes.forEach(mesh => {
            mesh.material.opacity = opacity;
            mesh.material.transparent = true;
        });
    }
    
    highlightLinksForNode(nodeId) {
        this.linkMeshes.forEach((mesh, index) => {
            const link = this.links[index];
            if (!link) return;
            
            if (link.sourceId === nodeId || link.targetId === nodeId) {
                mesh.material.opacity = 1;
                mesh.material.color.setHex(0xfbbf24);
            } else {
                mesh.material.opacity = 0.3;
            }
        });
    }
    
    resetLinkHighlighting() {
        this.linkMeshes.forEach((mesh, index) => {
            const link = this.links[index];
            if (!link) return;
            
            const source = this.nodes.get(link.sourceId);
            const target = this.nodes.get(link.targetId);
            
            if (source && target) {
                let color = '#94a3b8';
                if (source.community === target.community) {
                    color = this.communityColors[source.community] || '#94a3b8';
                }
                mesh.material.color.set(color);
            }
            
            mesh.material.opacity = 0.6;
        });
    }
    
    dispose() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        
        this.clearScene();
        
        if (this.renderer) {
            this.renderer.dispose();
        }
    }
}

window.Physics3DEngine = Physics3DEngine;
