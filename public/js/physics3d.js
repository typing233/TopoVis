class SpringDamperPhysics {
    constructor() {
        this.gravity = new THREE.Vector3(0, 0, 0);
        this.damping = 0.985;
        this.velocityDamping = 0.95;
        
        this.springConstant = 0.15;
        this.springDamping = 0.08;
        this.restLength = 120;
        
        this.repulsionStrength = 800;
        this.repulsionThreshold = 150;
        
        this.attractionStrength = 0.0005;
        
        this.collisionSpringConstant = 0.8;
        this.collisionDamping = 0.3;
    }
    
    calculateSpringForce(nodeA, nodeB, currentDistance, targetRestLength) {
        const force = new THREE.Vector3().subVectors(nodeB.position, nodeA.position);
        
        const stretch = currentDistance - targetRestLength;
        
        if (Math.abs(stretch) < 0.1) {
            return new THREE.Vector3(0, 0, 0);
        }
        
        force.normalize();
        
        const springForce = stretch * this.springConstant;
        
        const relativeVelocity = new THREE.Vector3().subVectors(nodeB.velocity, nodeA.velocity);
        const velocityAlongSpring = relativeVelocity.dot(force);
        const dampingForce = velocityAlongSpring * this.springDamping;
        
        const totalForce = springForce + dampingForce;
        force.multiplyScalar(totalForce);
        
        return force;
    }
    
    calculateRepulsionForce(nodeA, nodeB, distance) {
        if (distance > this.repulsionThreshold) {
            return new THREE.Vector3(0, 0, 0);
        }
        
        const direction = new THREE.Vector3().subVectors(nodeA.position, nodeB.position);
        direction.normalize();
        
        const distanceSq = distance * distance;
        const forceStrength = this.repulsionStrength / distanceSq;
        
        direction.multiplyScalar(forceStrength);
        
        return direction;
    }
    
    calculateCenterAttraction(node, center) {
        const force = new THREE.Vector3().subVectors(center, node.position);
        const distance = force.length() || 1;
        
        force.normalize();
        force.multiplyScalar(this.attractionStrength * distance);
        
        return force;
    }
    
    applyDamping(node) {
        node.velocity.multiplyScalar(this.velocityDamping);
    }
    
    integrate(node, dt) {
        const acceleration = node.acceleration.clone();
        acceleration.multiplyScalar(dt);
        
        node.velocity.add(acceleration);
        
        node.velocity.multiplyScalar(this.damping);
        
        const displacement = node.velocity.clone();
        displacement.multiplyScalar(dt);
        node.position.add(displacement);
        
        node.acceleration.set(0, 0, 0);
    }
}

class CollisionSpringSystem {
    constructor() {
        this.activeSprings = new Map();
        this.animationQueue = [];
    }
    
    createCollisionSpring(nodeA, nodeB, impactVelocity) {
        const key = `${nodeA.id}_${nodeB.id}`;
        const reverseKey = `${nodeB.id}_${nodeA.id}`;
        
        if (this.activeSprings.has(key) || this.activeSprings.has(reverseKey)) {
            return;
        }
        
        const spring = {
            nodeA,
            nodeB,
            impactTime: Date.now(),
            duration: 500 + Math.random() * 300,
            compressionPhase: 150,
            releasePhase: 350,
            maxCompression: 0.3 + Math.min(0.3, impactVelocity * 0.1),
            currentCompression: 0,
            phase: 'compressing'
        };
        
        this.activeSprings.set(key, spring);
    }
    
    updateSprings(currentTime) {
        const springsToRemove = [];
        
        this.activeSprings.forEach((spring, key) => {
            const elapsed = currentTime - spring.impactTime;
            
            if (spring.phase === 'compressing') {
                const progress = Math.min(1, elapsed / spring.compressionPhase);
                spring.currentCompression = progress * spring.maxCompression;
                
                if (elapsed >= spring.compressionPhase) {
                    spring.phase = 'releasing';
                }
            } else if (spring.phase === 'releasing') {
                const releaseElapsed = elapsed - spring.compressionPhase;
                const progress = Math.min(1, releaseElapsed / spring.releasePhase);
                const easeOut = 1 - Math.pow(1 - progress, 3);
                spring.currentCompression = spring.maxCompression * (1 - easeOut);
                
                if (releaseElapsed >= spring.releasePhase) {
                    spring.currentCompression = 0;
                    springsToRemove.push(key);
                }
            }
        });
        
        springsToRemove.forEach(key => {
            this.activeSprings.delete(key);
        });
    }
    
    getSpringCompression(nodeId) {
        let totalCompression = 0;
        let springCount = 0;
        
        this.activeSprings.forEach((spring, key) => {
            if (key.includes(nodeId)) {
                totalCompression += spring.currentCompression;
                springCount++;
            }
        });
        
        return springCount > 0 ? totalCompression / springCount : 0;
    }
    
    hasActiveSpring(nodeId) {
        for (const [key, spring] of this.activeSprings) {
            if (key.includes(nodeId)) {
                return true;
            }
        }
        return false;
    }
}

class NodeVisualSystem {
    constructor(scene) {
        this.scene = scene;
        this.nodeGroups = new Map();
    }
    
    createNodeStructure(nodeId, community, radius, color) {
        const group = new THREE.Group();
        
        const coreRadius = radius * 0.7;
        const coreGeometry = new THREE.IcosahedronGeometry(coreRadius, 3);
        const coreMaterial = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(color),
            metalness: 0.4,
            roughness: 0.3,
            clearcoat: 0.6,
            clearcoatRoughness: 0.2,
            emissive: new THREE.Color(color),
            emissiveIntensity: 0.05,
            transparent: true,
            opacity: 0.95
        });
        const core = new THREE.Mesh(coreGeometry, coreMaterial);
        core.castShadow = true;
        core.receiveShadow = true;
        core.name = 'core';
        
        const ringCount = 3;
        const rings = [];
        
        for (let i = 0; i < ringCount; i++) {
            const ringRadius = radius * (1.2 + i * 0.15);
            const ringThickness = 1 + i * 0.3;
            
            const ringGeometry = new THREE.TorusGeometry(ringRadius, ringThickness, 8, 48);
            const ringMaterial = new THREE.MeshPhysicalMaterial({
                color: new THREE.Color(color),
                metalness: 0.6,
                roughness: 0.2,
                clearcoat: 0.4,
                transparent: true,
                opacity: 0.4 - i * 0.1,
                side: THREE.DoubleSide
            });
            const ring = new THREE.Mesh(ringGeometry, ringMaterial);
            ring.castShadow = true;
            
            ring.rotation.x = Math.random() * Math.PI;
            ring.rotation.y = Math.random() * Math.PI;
            ring.rotation.z = Math.random() * Math.PI;
            
            ring.userData.rotationSpeed = {
                x: (Math.random() - 0.5) * 0.01,
                y: (Math.random() - 0.5) * 0.015,
                z: (Math.random() - 0.5) * 0.008
            };
            
            rings.push(ring);
            group.add(ring);
        }
        
        const glowRadius = radius * 1.8;
        const glowGeometry = new THREE.SphereGeometry(glowRadius, 32, 32);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: 0.08,
            side: THREE.BackSide
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        glow.name = 'glow';
        
        const haloGeometry = new THREE.RingGeometry(radius * 1.1, radius * 1.15, 64);
        const haloMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide
        });
        const halo = new THREE.Mesh(haloGeometry, haloMaterial);
        halo.rotation.x = Math.PI / 2;
        halo.position.y = -radius * 0.5;
        halo.name = 'halo';
        
        const pulseGeometry = new THREE.SphereGeometry(radius * 1.3, 32, 32);
        const pulseMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: 0,
            wireframe: true,
            wireframeLinewidth: 1
        });
        const pulse = new THREE.Mesh(pulseGeometry, pulseMaterial);
        pulse.name = 'pulse';
        pulse.visible = false;
        
        group.add(core);
        group.add(glow);
        group.add(halo);
        group.add(pulse);
        
        group.userData = {
            nodeId,
            community,
            radius,
            core,
            rings,
            glow,
            halo,
            pulse,
            color,
            originalScale: 1,
            baseScale: 1,
            targetScale: 1,
            currentEmissive: 0.05
        };
        
        this.nodeGroups.set(nodeId, group);
        this.scene.add(group);
        
        return group;
    }
    
    updateNodeVisuals(nodeId, compression = 0, velocity = 0) {
        const group = this.nodeGroups.get(nodeId);
        if (!group) return;
        
        const userData = group.userData;
        
        if (compression > 0) {
            const compressionScale = 1 - compression * 0.4;
            userData.targetScale = compressionScale;
            
            if (userData.core) {
                userData.core.material.emissiveIntensity = 0.3 + compression * 0.5;
            }
            
            if (userData.pulse && !userData.pulse.visible) {
                userData.pulse.visible = true;
                userData.pulse.scale.set(1, 1, 1);
                userData.pulse.material.opacity = 0.5;
            }
        } else {
            userData.targetScale = userData.baseScale;
            
            if (userData.core) {
                const currentEmissive = userData.core.material.emissiveIntensity;
                userData.core.material.emissiveIntensity += (0.05 - currentEmissive) * 0.1;
            }
        }
        
        const currentScale = group.scale.x;
        const newScale = currentScale + (userData.targetScale - currentScale) * 0.15;
        group.scale.set(newScale, newScale, newScale);
        
        if (userData.rings) {
            userData.rings.forEach(ring => {
                ring.rotation.x += ring.userData.rotationSpeed.x * (1 + velocity * 0.1);
                ring.rotation.y += ring.userData.rotationSpeed.y * (1 + velocity * 0.1);
                ring.rotation.z += ring.userData.rotationSpeed.z * (1 + velocity * 0.1);
            });
        }
        
        if (userData.pulse && userData.pulse.visible) {
            const pulseScale = userData.pulse.scale.x * 1.05;
            userData.pulse.scale.set(pulseScale, pulseScale, pulseScale);
            userData.pulse.material.opacity *= 0.92;
            
            if (userData.pulse.material.opacity < 0.01) {
                userData.pulse.visible = false;
            }
        }
        
        if (velocity > 0.1 && userData.halo) {
            const haloScale = 1 + velocity * 0.05;
            userData.halo.scale.set(haloScale, haloScale, haloScale);
        }
    }
    
    highlightNode(nodeId, isHighlighted) {
        const group = this.nodeGroups.get(nodeId);
        if (!group) return;
        
        const userData = group.userData;
        
        if (isHighlighted) {
            userData.baseScale = 1.2;
            
            if (userData.core) {
                userData.core.material.emissiveIntensity = 0.4;
            }
            
            if (userData.pulse) {
                userData.pulse.visible = true;
                userData.pulse.scale.set(1, 1, 1);
                userData.pulse.material.opacity = 0.4;
            }
        } else {
            userData.baseScale = 1;
            
            if (userData.core) {
                userData.core.material.emissiveIntensity = 0.05;
            }
        }
    }
    
    triggerCollisionEffect(nodeId) {
        const group = this.nodeGroups.get(nodeId);
        if (!group) return;
        
        const userData = group.userData;
        
        if (userData.core) {
            userData.core.material.emissiveIntensity = 0.8;
        }
        
        if (userData.pulse) {
            userData.pulse.visible = true;
            userData.pulse.scale.set(1, 1, 1);
            userData.pulse.material.opacity = 0.6;
        }
    }
    
    getNodeGroup(nodeId) {
        return this.nodeGroups.get(nodeId);
    }
}

class LinkVisualSystem {
    constructor(scene) {
        this.scene = scene;
        this.links = [];
        this.linkMeshes = [];
    }
    
    createLink(source, target, sourceCommunity, targetCommunity, communityColors) {
        const link = {
            source,
            target,
            sourceCommunity,
            targetCommunity
        };
        
        let color = '#94a3b8';
        let isSameCommunity = false;
        
        if (sourceCommunity === targetCommunity) {
            color = communityColors[sourceCommunity] || '#94a3b8';
            isSameCommunity = true;
        }
        
        const midPoint = new THREE.Vector3().addVectors(
            source.position,
            target.position
        ).multiplyScalar(0.5);
        
        const curve = new THREE.QuadraticBezierCurve3(
            source.position.clone(),
            midPoint.clone().add(new THREE.Vector3(
                (Math.random() - 0.5) * 20,
                (Math.random() - 0.5) * 20,
                (Math.random() - 0.5) * 20
            )),
            target.position.clone()
        );
        
        const tubeGeometry = new THREE.TubeGeometry(curve, 16, isSameCommunity ? 1 : 0.5, 8, false);
        
        const mainMaterial = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(color),
            metalness: 0.3,
            roughness: 0.4,
            transparent: true,
            opacity: isSameCommunity ? 0.7 : 0.4
        });
        
        const mainMesh = new THREE.Mesh(tubeGeometry, mainMaterial);
        mainMesh.userData = {
            sourceId: source.id,
            targetId: target.id,
            isSameCommunity
        };
        
        const glowGeometry = new THREE.TubeGeometry(curve, 16, isSameCommunity ? 2 : 1, 8, false);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: isSameCommunity ? 0.15 : 0.08
        });
        const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
        
        const group = new THREE.Group();
        group.add(mainMesh);
        group.add(glowMesh);
        
        this.links.push(link);
        this.linkMeshes.push({
            group,
            mainMesh,
            glowMesh,
            curve,
            link
        });
        
        this.scene.add(group);
        
        return { link, meshGroup: group };
    }
    
    updateLinks() {
        this.linkMeshes.forEach((linkMesh, index) => {
            const { link, curve } = linkMesh;
            
            if (!link.source || !link.target) return;
            
            const midPoint = new THREE.Vector3().addVectors(
                link.source.position,
                link.target.position
            ).multiplyScalar(0.5);
            
            curve.v0.copy(link.source.position);
            curve.v2.copy(link.target.position);
            
            const direction = new THREE.Vector3().subVectors(
                link.target.position,
                link.source.position
            );
            const length = direction.length();
            direction.normalize();
            
            const perpendicular = new THREE.Vector3(
                -direction.z,
                0,
                direction.x
            ).normalize();
            
            const offsetAmount = length * 0.1;
            curve.v1.copy(midPoint).add(
                perpendicular.multiplyScalar(offsetAmount)
            );
            
            const mainGeometry = linkMesh.mainMesh.geometry;
            const glowGeometry = linkMesh.glowMesh.geometry;
            
            const tempGeometry = new THREE.TubeGeometry(curve, 16, 
                linkMesh.mainMesh.userData.isSameCommunity ? 1 : 0.5, 8, false);
            
            const positions = mainGeometry.attributes.position;
            const newPositions = tempGeometry.attributes.position;
            
            for (let i = 0; i < positions.count; i++) {
                positions.setXYZ(i, 
                    newPositions.getX(i),
                    newPositions.getY(i),
                    newPositions.getZ(i)
                );
            }
            positions.needsUpdate = true;
            
            mainGeometry.computeBoundingSphere();
            
            tempGeometry.dispose();
        });
    }
    
    highlightLink(sourceId, targetId, isHighlighted) {
        this.linkMeshes.forEach(linkMesh => {
            const userData = linkMesh.mainMesh.userData;
            if ((userData.sourceId === sourceId && userData.targetId === targetId) ||
                (userData.sourceId === targetId && userData.targetId === sourceId)) {
                
                if (isHighlighted) {
                    linkMesh.mainMesh.material.opacity = 1;
                    linkMesh.mainMesh.material.emissive = new THREE.Color(0xfbbf24);
                    linkMesh.mainMesh.material.emissiveIntensity = 0.3;
                    linkMesh.glowMesh.material.opacity = 0.3;
                } else {
                    linkMesh.mainMesh.material.opacity = userData.isSameCommunity ? 0.7 : 0.4;
                    linkMesh.mainMesh.material.emissiveIntensity = 0;
                    linkMesh.glowMesh.material.opacity = userData.isSameCommunity ? 0.15 : 0.08;
                }
            }
        });
    }
    
    highlightAllLinksForNode(nodeId, isHighlighted) {
        this.linkMeshes.forEach(linkMesh => {
            const userData = linkMesh.mainMesh.userData;
            if (userData.sourceId === nodeId || userData.targetId === nodeId) {
                if (isHighlighted) {
                    linkMesh.mainMesh.material.opacity = 1;
                    linkMesh.mainMesh.material.emissive = new THREE.Color(0xfbbf24);
                    linkMesh.mainMesh.material.emissiveIntensity = 0.3;
                    linkMesh.glowMesh.material.opacity = 0.3;
                } else {
                    linkMesh.mainMesh.material.opacity = userData.isSameCommunity ? 0.7 : 0.4;
                    linkMesh.mainMesh.material.emissiveIntensity = 0;
                    linkMesh.glowMesh.material.opacity = userData.isSameCommunity ? 0.15 : 0.08;
                }
            }
        });
    }
    
    resetAllHighlights() {
        this.linkMeshes.forEach(linkMesh => {
            const userData = linkMesh.mainMesh.userData;
            linkMesh.mainMesh.material.opacity = userData.isSameCommunity ? 0.7 : 0.4;
            linkMesh.mainMesh.material.emissiveIntensity = 0;
            linkMesh.glowMesh.material.opacity = userData.isSameCommunity ? 0.15 : 0.08;
        });
    }
    
    clear() {
        this.linkMeshes.forEach(linkMesh => {
            this.scene.remove(linkMesh.group);
            if (linkMesh.mainMesh.geometry) linkMesh.mainMesh.geometry.dispose();
            if (linkMesh.glowMesh.geometry) linkMesh.glowMesh.geometry.dispose();
            if (linkMesh.mainMesh.material) linkMesh.mainMesh.material.dispose();
            if (linkMesh.glowMesh.material) linkMesh.glowMesh.material.dispose();
        });
        this.links = [];
        this.linkMeshes = [];
    }
}

class StateTransitionSystem {
    constructor() {
        this.isTransitioning = false;
        this.transitions = new Map();
        this.cameraTransition = null;
        this.onTransitionComplete = null;
    }
    
    startTransition(fromState, toState, nodes, duration = 800) {
        this.isTransitioning = true;
        this.transitions.clear();
        
        const startTime = Date.now();
        
        toState.nodes.forEach(targetNode => {
            const fromNodeData = fromState.nodes.find(n => n.id === targetNode.id);
            
            if (fromNodeData) {
                this.transitions.set(targetNode.id, {
                    nodeId: targetNode.id,
                    startPos: new THREE.Vector3(
                        fromNodeData.position.x,
                        fromNodeData.position.y,
                        fromNodeData.position.z
                    ),
                    endPos: new THREE.Vector3(
                        targetNode.position.x,
                        targetNode.position.y,
                        targetNode.position.z
                    ),
                    startVel: new THREE.Vector3(
                        fromNodeData.velocity.x,
                        fromNodeData.velocity.y,
                        fromNodeData.velocity.z
                    ),
                    endVel: new THREE.Vector3(
                        targetNode.velocity.x,
                        targetNode.velocity.y,
                        targetNode.velocity.z
                    )
                });
            }
        });
        
        return new Promise(resolve => {
            const animate = () => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(1, elapsed / duration);
                
                const easedProgress = this.easeInOutCubic(progress);
                
                this.transitions.forEach((transition, nodeId) => {
                    const node = nodes.get(nodeId);
                    if (!node) return;
                    
                    node.position.lerpVectors(
                        transition.startPos,
                        transition.endPos,
                        easedProgress
                    );
                    
                    node.velocity.lerpVectors(
                        transition.startVel,
                        transition.endVel,
                        easedProgress
                    );
                });
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    this.isTransitioning = false;
                    this.transitions.clear();
                    resolve();
                }
            };
            
            animate();
        });
    }
    
    startCameraTransition(camera, controls, targetPosition, targetLookAt, duration = 600) {
        const startTime = Date.now();
        const startPosition = camera.position.clone();
        const startLookAt = controls.target.clone();
        
        return new Promise(resolve => {
            const animate = () => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(1, elapsed / duration);
                
                const easedProgress = this.easeInOutCubic(progress);
                
                camera.position.lerpVectors(startPosition, targetPosition, easedProgress);
                controls.target.lerpVectors(startLookAt, targetLookAt, easedProgress);
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    resolve();
                }
            };
            
            animate();
        });
    }
    
    easeInOutCubic(t) {
        return t < 0.5 
            ? 4 * t * t * t 
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
    
    easeOutQuart(t) {
        return 1 - Math.pow(1 - t, 4);
    }
    
    easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }
}

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
        this.graphData = null;
        this.isPhysicsEnabled = true;
        this.isPaused = false;
        this.animationId = null;
        
        this.physics = new SpringDamperPhysics();
        this.collisionSystem = new CollisionSpringSystem();
        
        this.selectedNode = null;
        this.hoveredNode = null;
        this.draggingNode = null;
        
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
        
        this.transitionSystem = new StateTransitionSystem();
        
        this.fixedTimeStep = 16;
        this.accumulator = 0;
        this.lastTime = performance.now();
        
        this.init();
    }
    
    init() {
        this.createScene();
        this.createCamera();
        this.createRenderer();
        this.createControls();
        this.createLights();
        this.createHelpers();
        
        this.nodeVisualSystem = new NodeVisualSystem(this.scene);
        this.linkVisualSystem = new LinkVisualSystem(this.scene);
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.setupEventListeners();
        this.animate();
    }
    
    createScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf1f5f9);
        this.scene.fog = new THREE.FogExp2(0xf1f5f9, 0.0008);
    }
    
    createCamera() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        
        this.camera = new THREE.PerspectiveCamera(
            50,
            width / height,
            0.1,
            5000
        );
        this.camera.position.set(0, 400, 600);
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
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    
    createControls() {
        const OrbitControls = THREE.OrbitControls || window.OrbitControls || window.THREE?.OrbitControls;
        
        if (!OrbitControls) {
            console.error('OrbitControls is not available');
            return;
        }
        
        this.controls = new OrbitControls(
            this.camera,
            this.renderer.domElement
        );
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.enablePan = true;
        this.controls.enableZoom = true;
        this.controls.enableRotate = true;
        this.controls.minDistance = 150;
        this.controls.maxDistance = 2500;
        this.controls.autoRotate = false;
        this.controls.autoRotateSpeed = 0.3;
        this.controls.screenSpacePanning = true;
    }
    
    createLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);
        
        const mainLight = new THREE.DirectionalLight(0xffffff, 0.9);
        mainLight.position.set(200, 400, 200);
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.width = 2048;
        mainLight.shadow.mapSize.height = 2048;
        mainLight.shadow.camera.near = 0.5;
        mainLight.shadow.camera.far = 2000;
        mainLight.shadow.camera.left = -800;
        mainLight.shadow.camera.right = 800;
        mainLight.shadow.camera.top = 800;
        mainLight.shadow.camera.bottom = -800;
        mainLight.shadow.bias = -0.0001;
        this.scene.add(mainLight);
        
        const fillLight = new THREE.DirectionalLight(0x60a5fa, 0.4);
        fillLight.position.set(-200, 200, -200);
        this.scene.add(fillLight);
        
        const rimLight = new THREE.DirectionalLight(0xf472b6, 0.3);
        rimLight.position.set(0, -100, -300);
        this.scene.add(rimLight);
        
        const pointLight1 = new THREE.PointLight(0x60a5fa, 0.3, 1000);
        pointLight1.position.set(-300, 100, 300);
        this.scene.add(pointLight1);
        
        const pointLight2 = new THREE.PointLight(0xf472b6, 0.2, 1000);
        pointLight2.position.set(300, 100, -300);
        this.scene.add(pointLight2);
    }
    
    createHelpers() {
        const gridHelper = new THREE.GridHelper(2000, 100, 0xe2e8f0, 0xf1f5f9);
        gridHelper.position.y = -100;
        this.scene.add(gridHelper);
        
        const axesHelper = new THREE.AxesHelper(50);
        axesHelper.position.y = -99;
        this.scene.add(axesHelper);
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
            const planeNormal = new THREE.Vector3(0, 1, 0);
            const cameraDirection = new THREE.Vector3().subVectors(
                this.camera.position,
                this.controls.target
            ).normalize();
            
            const dot = Math.abs(cameraDirection.dot(planeNormal));
            const useXZPlane = dot > 0.5;
            
            let plane;
            if (useXZPlane) {
                const node = this.nodes.get(this.draggingNode);
                plane = new THREE.Plane(planeNormal, -node.position.y);
            } else {
                plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
            }
            
            const intersection = new THREE.Vector3();
            this.raycaster.ray.intersectPlane(plane, intersection);
            
            if (intersection) {
                const node = this.nodes.get(this.draggingNode);
                if (node) {
                    const previousPos = node.position.clone();
                    node.position.copy(intersection);
                    node.velocity.set(0, 0, 0);
                    
                    const velocity = new THREE.Vector3().subVectors(node.position, previousPos);
                    node.velocity.copy(velocity);
                }
            }
        } else {
            if (intersects.length > 0) {
                const mesh = intersects[0].object;
                const nodeId = mesh.userData.nodeId;
                
                if (nodeId) {
                    this.renderer.domElement.style.cursor = 'pointer';
                    
                    if (this.hoveredNode !== nodeId) {
                        if (this.hoveredNode && this.nodeVisualSystem) {
                            this.nodeVisualSystem.highlightNode(this.hoveredNode, false);
                        }
                        
                        this.hoveredNode = nodeId;
                        if (this.nodeVisualSystem) {
                            this.nodeVisualSystem.highlightNode(nodeId, true);
                        }
                        
                        if (this.linkVisualSystem) {
                            this.linkVisualSystem.highlightAllLinksForNode(nodeId, true);
                        }
                        
                        if (this.onNodeHover) {
                            this.onNodeHover(nodeId, this.nodes.get(nodeId));
                        }
                    }
                }
            } else {
                if (this.hoveredNode) {
                    if (this.nodeVisualSystem) {
                        this.nodeVisualSystem.highlightNode(this.hoveredNode, false);
                    }
                    if (this.linkVisualSystem) {
                        this.linkVisualSystem.resetAllHighlights();
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
        
        if (this.nodeVisualSystem) {
            this.nodeVisualSystem.nodeGroups.forEach(group => {
                if (group.userData.core) {
                    meshes.push(group.userData.core);
                }
                group.userData.rings?.forEach(ring => meshes.push(ring));
            });
        }
        
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
        if (this.nodeVisualSystem) {
            this.nodeVisualSystem.nodeGroups.forEach((group, nodeId) => {
                this.scene.remove(group);
                group.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
            });
            this.nodeVisualSystem.nodeGroups.clear();
        }
        
        if (this.linkVisualSystem) {
            this.linkVisualSystem.clear();
        }
        
        this.nodes.clear();
        this.collisionSystem.activeSprings.clear();
    }
    
    initializeNodes() {
        if (!this.graphData || !this.graphData.nodes) return;
        
        const communities = [...new Set(this.graphData.nodes.map(n => n.community))];
        this.colorScale.domain(communities);
        
        this.graphData.nodes.forEach(node => {
            this.communityColors[node.community] = this.colorScale(node.community);
        });
        
        const communityNodes = new Map();
        communities.forEach(comm => {
            communityNodes.set(comm, []);
        });
        
        this.graphData.nodes.forEach(node => {
            communityNodes.get(node.community)?.push(node);
        });
        
        const communityPositions = this.calculateCommunityLayout(communities.length);
        
        communities.forEach((comm, commIndex) => {
            const nodes = communityNodes.get(comm) || [];
            const commCenter = communityPositions[commIndex];
            
            nodes.forEach((node, nodeIndex) => {
                const angle = (nodeIndex / Math.max(nodes.length, 1)) * Math.PI * 2;
                const radius = 30 + Math.sqrt(nodes.length) * 15;
                
                const position = new THREE.Vector3(
                    commCenter.x + Math.cos(angle) * radius,
                    commCenter.y + (Math.random() - 0.5) * 50,
                    commCenter.z + Math.sin(angle) * radius
                );
                
                const degree = this.getNodeDegree(node.id);
                
                this.nodes.set(node.id, {
                    id: node.id,
                    data: node,
                    position: position,
                    velocity: new THREE.Vector3(0, 0, 0),
                    acceleration: new THREE.Vector3(0, 0, 0),
                    community: node.community,
                    degree: degree,
                    mass: Math.max(0.5, Math.min(2, 0.5 + degree * 0.1))
                });
                
                const baseRadius = 12;
                const radiusScaled = baseRadius + Math.sqrt(degree) * 2.5;
                
                if (this.nodeVisualSystem) {
                    this.nodeVisualSystem.createNodeStructure(
                        node.id,
                        node.community,
                        radiusScaled,
                        this.communityColors[node.community]
                    );
                }
            });
        });
    }
    
    calculateCommunityLayout(communityCount) {
        const positions = [];
        const communityRadius = 200 + Math.sqrt(communityCount) * 50;
        
        for (let i = 0; i < communityCount; i++) {
            const angle = (i / communityCount) * Math.PI * 2;
            const heightOffset = (i % 2 === 0 ? 1 : -1) * (Math.random() * 100);
            
            positions.push(new THREE.Vector3(
                Math.cos(angle) * communityRadius,
                heightOffset,
                Math.sin(angle) * communityRadius
            ));
        }
        
        return positions;
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
    
    initializeLinks() {
        if (!this.graphData || !this.graphData.links) return;
        
        this.graphData.links.forEach((link, index) => {
            let sourceId, targetId;
            
            if (typeof link.source === 'object') {
                sourceId = link.source.id;
                targetId = link.target.id;
            } else {
                sourceId = link.source;
                targetId = link.target;
            }
            
            const source = this.nodes.get(sourceId);
            const target = this.nodes.get(targetId);
            
            if (source && target) {
                if (this.linkVisualSystem) {
                    this.linkVisualSystem.createLink(
                        source,
                        target,
                        source.community,
                        target.community,
                        this.communityColors
                    );
                }
            }
        });
    }
    
    updatePhysics(dt) {
        if (!this.isPhysicsEnabled || this.isPaused) return;
        if (this.transitionSystem.isTransitioning) return;
        
        const nodeArray = Array.from(this.nodes.values());
        const currentTime = Date.now();
        
        let center = new THREE.Vector3(0, 0, 0);
        nodeArray.forEach(node => {
            center.add(node.position);
        });
        center.divideScalar(nodeArray.length);
        
        nodeArray.forEach(node => {
            if (node.id === this.draggingNode) return;
            
            const acceleration = new THREE.Vector3(0, 0, 0);
            
            nodeArray.forEach(otherNode => {
                if (node.id === otherNode.id) return;
                
                const diff = new THREE.Vector3().subVectors(node.position, otherNode.position);
                const distance = diff.length() || 0.1;
                
                const nodeGroupA = this.nodeVisualSystem?.getNodeGroup(node.id);
                const nodeGroupB = this.nodeVisualSystem?.getNodeGroup(otherNode.id);
                
                const radiusA = nodeGroupA?.userData?.radius || 20;
                const radiusB = nodeGroupB?.userData?.radius || 20;
                const collisionDistance = radiusA + radiusB;
                
                if (distance < collisionDistance * 1.5) {
                    const repulsionForce = this.physics.calculateRepulsionForce(node, otherNode, distance);
                    acceleration.add(repulsionForce);
                }
                
                if (distance < collisionDistance) {
                    const impactVelocity = new THREE.Vector3()
                        .subVectors(node.velocity, otherNode.velocity)
                        .length();
                    
                    this.collisionSystem.createCollisionSpring(node, otherNode, impactVelocity);
                    
                    if (this.nodeVisualSystem) {
                        this.nodeVisualSystem.triggerCollisionEffect(node.id);
                        this.nodeVisualSystem.triggerCollisionEffect(otherNode.id);
                    }
                    
                    const overlap = collisionDistance - distance;
                    const correction = diff.clone().normalize().multiplyScalar(overlap * 0.5);
                    
                    node.position.add(correction);
                    otherNode.position.sub(correction);
                    
                    const relativeVelocity = new THREE.Vector3().subVectors(node.velocity, otherNode.velocity);
                    const velocityAlongNormal = relativeVelocity.dot(diff.clone().normalize());
                    
                    if (velocityAlongNormal > 0) {
                        const restitution = 0.3;
                        const j = -(1 + restitution) * velocityAlongNormal;
                        
                        const totalMass = (1 / node.mass) + (1 / otherNode.mass);
                        const impulse = j / totalMass;
                        
                        const impulseVector = diff.clone().normalize().multiplyScalar(impulse);
                        
                        node.velocity.add(impulseVector.divideScalar(node.mass));
                        otherNode.velocity.sub(impulseVector.divideScalar(otherNode.mass));
                    }
                }
            });
            
            this.updateLinkForces(node, acceleration);
            
            const centerAttraction = this.physics.calculateCenterAttraction(node, center);
            acceleration.add(centerAttraction);
            
            node.acceleration.copy(acceleration);
            
            this.physics.integrate(node, dt / 1000);
            
            this.physics.applyDamping(node);
        });
        
        this.collisionSystem.updateSprings(currentTime);
        
        if (this.nodeVisualSystem) {
            nodeArray.forEach(node => {
                const compression = this.collisionSystem.getSpringCompression(node.id);
                const velocity = node.velocity.length();
                
                this.nodeVisualSystem.updateNodeVisuals(node.id, compression, velocity);
                
                const nodeGroup = this.nodeVisualSystem.getNodeGroup(node.id);
                if (nodeGroup) {
                    nodeGroup.position.copy(node.position);
                }
            });
        }
        
        if (this.linkVisualSystem) {
            this.linkVisualSystem.updateLinks();
        }
    }
    
    updateLinkForces(node, acceleration) {
        if (!this.linkVisualSystem) return;
        
        this.linkVisualSystem.links.forEach(link => {
            let other = null;
            let restLength = this.physics.restLength;
            
            if (link.source.id === node.id) {
                other = this.nodes.get(link.target.id);
            } else if (link.target.id === node.id) {
                other = this.nodes.get(link.source.id);
            }
            
            if (!other) return;
            
            const sourceCommunity = link.source.community;
            const targetCommunity = link.target.community;
            
            if (sourceCommunity === targetCommunity) {
                restLength *= 0.8;
            } else {
                restLength *= 1.3;
            }
            
            const distance = node.position.distanceTo(other.position);
            
            if (distance < 10) return;
            
            const springForce = this.physics.calculateSpringForce(node, other, distance, restLength);
            acceleration.add(springForce);
        });
    }
    
    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());
        
        const currentTime = performance.now();
        const frameTime = currentTime - this.lastTime;
        this.lastTime = currentTime;
        
        this.accumulator += Math.min(frameTime, 50);
        
        while (this.accumulator >= this.fixedTimeStep) {
            this.updatePhysics(this.fixedTimeStep);
            this.accumulator -= this.fixedTimeStep;
        }
        
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
    
    zoomIn() {
        this.controls.dollyIn(1.1);
    }
    
    zoomOut() {
        this.controls.dollyOut(1.1);
    }
    
    resetZoom() {
        this.camera.position.set(0, 400, 600);
        this.controls.reset();
    }
    
    centerView() {
        if (this.nodes.size === 0) return;
        
        let center = new THREE.Vector3(0, 0, 0);
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        this.nodes.forEach(node => {
            center.add(node.position);
            minX = Math.min(minX, node.position.x);
            maxX = Math.max(maxX, node.position.x);
            minY = Math.min(minY, node.position.y);
            maxY = Math.max(maxY, node.position.y);
            minZ = Math.min(minZ, node.position.z);
            maxZ = Math.max(maxZ, node.position.z);
        });
        
        center.divideScalar(this.nodes.size);
        
        const width = maxX - minX;
        const height = maxY - minY;
        const depth = maxZ - minZ;
        const maxDim = Math.max(width, height, depth);
        
        const fov = this.camera.fov * (Math.PI / 180);
        const cameraDistance = maxDim / (2 * Math.tan(fov / 2)) * 1.5;
        
        const direction = new THREE.Vector3(0.5, 0.5, 1).normalize();
        const targetPosition = new THREE.Vector3().addVectors(
            center,
            direction.multiplyScalar(cameraDistance)
        );
        
        if (this.transitionSystem) {
            this.transitionSystem.startCameraTransition(
                this.camera,
                this.controls,
                targetPosition,
                center
            );
        } else {
            this.camera.position.copy(targetPosition);
            this.controls.target.copy(center);
        }
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
            removedNodes: [],
            cameraPosition: {
                x: this.camera.position.x,
                y: this.camera.position.y,
                z: this.camera.position.z
            },
            cameraTarget: {
                x: this.controls.target.x,
                y: this.controls.target.y,
                z: this.controls.target.z
            }
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
                degree: node.degree,
                mass: node.mass
            });
        });
        
        if (this.linkVisualSystem) {
            this.linkVisualSystem.links.forEach(link => {
                state.links.push({
                    sourceId: link.source.id,
                    targetId: link.target.id
                });
            });
        }
        
        return state;
    }
    
    async restoreState(state, animate = true) {
        if (!state || !state.nodes) return;
        
        const currentState = this.getState();
        
        if (animate && this.transitionSystem) {
            this.controls.enabled = false;
            
            await this.transitionSystem.startTransition(
                currentState,
                { nodes: state.nodes.map(n => ({
                    id: n.id,
                    position: new THREE.Vector3(n.position.x, n.position.y, n.position.z),
                    velocity: new THREE.Vector3(n.velocity.x, n.velocity.y, n.velocity.z)
                })) },
                this.nodes,
                600
            );
            
            if (state.cameraPosition && state.cameraTarget) {
                await this.transitionSystem.startCameraTransition(
                    this.camera,
                    this.controls,
                    new THREE.Vector3(
                        state.cameraPosition.x,
                        state.cameraPosition.y,
                        state.cameraPosition.z
                    ),
                    new THREE.Vector3(
                        state.cameraTarget.x,
                        state.cameraTarget.y,
                        state.cameraTarget.z
                    ),
                    400
                );
            }
            
            this.controls.enabled = true;
        } else {
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
                    
                    const nodeGroup = this.nodeVisualSystem?.getNodeGroup(nodeState.id);
                    if (nodeGroup) {
                        nodeGroup.position.copy(node.position);
                    }
                }
            });
            
            if (state.cameraPosition && state.cameraTarget) {
                this.camera.position.set(
                    state.cameraPosition.x,
                    state.cameraPosition.y,
                    state.cameraPosition.z
                );
                this.controls.target.set(
                    state.cameraTarget.x,
                    state.cameraTarget.y,
                    state.cameraTarget.z
                );
            }
        }
        
        if (this.linkVisualSystem) {
            this.linkVisualSystem.updateLinks();
        }
    }
    
    removeNode(nodeId, animate = true) {
        const node = this.nodes.get(nodeId);
        if (!node) return;
        
        const nodeGroup = this.nodeVisualSystem?.getNodeGroup(nodeId);
        if (nodeGroup && animate) {
            const collapseAnimation = () => {
                nodeGroup.scale.multiplyScalar(0.92);
                nodeGroup.rotation.x += 0.08;
                nodeGroup.rotation.y += 0.08;
                nodeGroup.rotation.z += 0.08;
                
                if (nodeGroup.userData.core) {
                    nodeGroup.userData.core.material.opacity *= 0.95;
                }
                
                if (nodeGroup.scale.x > 0.02) {
                    requestAnimationFrame(collapseAnimation);
                } else {
                    nodeGroup.visible = false;
                }
            };
            collapseAnimation();
        } else if (nodeGroup) {
            nodeGroup.visible = false;
        }
    }
    
    restoreNode(nodeId) {
        const nodeGroup = this.nodeVisualSystem?.getNodeGroup(nodeId);
        if (nodeGroup) {
            nodeGroup.visible = true;
            nodeGroup.scale.setScalar(1);
            nodeGroup.rotation.set(0, 0, 0);
            
            if (nodeGroup.userData.core) {
                nodeGroup.userData.core.material.opacity = 0.95;
            }
        }
    }
    
    getNodeData(nodeId) {
        return this.nodes.get(nodeId);
    }
    
    getAdjacentNodes(nodeId) {
        const adjacent = [];
        
        if (this.linkVisualSystem) {
            this.linkVisualSystem.links.forEach(link => {
                if (link.source.id === nodeId) {
                    adjacent.push(link.target.id);
                } else if (link.target.id === nodeId) {
                    adjacent.push(link.source.id);
                }
            });
        }
        
        return adjacent;
    }
    
    setSelectedNode(nodeId) {
        if (this.selectedNode && this.nodeVisualSystem) {
            this.nodeVisualSystem.highlightNode(this.selectedNode, false);
        }
        
        this.selectedNode = nodeId;
        
        if (nodeId && this.nodeVisualSystem) {
            this.nodeVisualSystem.highlightNode(nodeId, true);
        }
        
        if (this.linkVisualSystem) {
            this.linkVisualSystem.resetAllHighlights();
            if (nodeId) {
                this.linkVisualSystem.highlightAllLinksForNode(nodeId, true);
            }
        }
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
