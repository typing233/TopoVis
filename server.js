const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const csv = require('csv-parser');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

fs.ensureDirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

class LouvainCommunityDetection {
  constructor(graph) {
    this.nodes = graph.nodes;
    this.links = graph.links;
    this.nodeIndex = {};
    this.communities = [];
    this.degrees = {};
    this.m = 0;
  }

  detect() {
    this._initialize();
    let improvement = true;
    let level = 0;
    
    while (improvement && level < 10) {
      improvement = this._onePass();
      if (improvement) {
        this._aggregateCommunities();
        level++;
      }
    }
    
    return this._getCommunities();
  }

  _initialize() {
    this.nodes.forEach((node, i) => {
      this.nodeIndex[node.id] = i;
      this.communities[i] = i;
      this.degrees[i] = 0;
    });

    this.links.forEach(link => {
      const sourceIdx = this.nodeIndex[link.source];
      const targetIdx = this.nodeIndex[link.target];
      const weight = link.weight || 1;
      this.degrees[sourceIdx] += weight;
      this.degrees[targetIdx] += weight;
      this.m += weight;
    });
  }

  _onePass() {
    let improvement = false;
    let nodes = Object.keys(this.nodeIndex).map(id => this.nodeIndex[id]);
    
    for (let iteration = 0; iteration < 10; iteration++) {
      let moved = false;
      
      for (let i = 0; i < nodes.length; i++) {
        const nodeIdx = nodes[i];
        const currentCommunity = this.communities[nodeIdx];
        
        const communityConnections = {};
        communityConnections[currentCommunity] = 0;
        
        this.links.forEach(link => {
          let sourceIdx, targetIdx;
          if (typeof link.source === 'object') {
            sourceIdx = this.nodeIndex[link.source.id];
            targetIdx = this.nodeIndex[link.target.id];
          } else {
            sourceIdx = this.nodeIndex[link.source];
            targetIdx = this.nodeIndex[link.target];
          }
          
          const weight = link.weight || 1;
          
          if (sourceIdx === nodeIdx) {
            const targetComm = this.communities[targetIdx];
            communityConnections[targetComm] = (communityConnections[targetComm] || 0) + weight;
          }
          if (targetIdx === nodeIdx) {
            const sourceComm = this.communities[sourceIdx];
            communityConnections[sourceComm] = (communityConnections[sourceComm] || 0) + weight;
          }
        });
        
        this.communities[nodeIdx] = -1;
        
        let bestCommunity = currentCommunity;
        let bestGain = 0;
        
        Object.keys(communityConnections).forEach(comm => {
          const commInt = parseInt(comm);
          if (commInt === currentCommunity) return;
          
          const gain = this._modularityGain(nodeIdx, commInt, communityConnections[commInt]);
          
          if (gain > bestGain) {
            bestGain = gain;
            bestCommunity = commInt;
          }
        });
        
        if (bestCommunity !== currentCommunity && bestGain > 0) {
          this.communities[nodeIdx] = bestCommunity;
          moved = true;
          improvement = true;
        } else {
          this.communities[nodeIdx] = currentCommunity;
        }
      }
      
      if (!moved) break;
    }
    
    return improvement;
  }

  _modularityGain(nodeIdx, targetCommunity, k_i_in) {
    const sumTot = this._getCommunitySum(targetCommunity);
    const k_i = this.degrees[nodeIdx];
    const m = this.m;
    
    return k_i_in - (sumTot * k_i) / (2 * m);
  }

  _getCommunitySum(community) {
    let sum = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.communities[i] === community) {
        sum += this.degrees[i];
      }
    }
    return sum;
  }

  _aggregateCommunities() {
    const uniqueCommunities = [...new Set(this.communities)];
    const communityMapping = {};
    uniqueCommunities.forEach((comm, idx) => {
      communityMapping[comm] = idx;
    });
    
    const newNodes = uniqueCommunities.map((comm, idx) => ({
      id: `community_${idx}`,
      originalCommunities: [comm],
      originalNodes: this.nodes.filter((_, i) => this.communities[i] === comm)
    }));
    
    const newLinks = [];
    const linkMap = {};
    
    this.links.forEach(link => {
      let sourceIdx, targetIdx;
      if (typeof link.source === 'object') {
        sourceIdx = this.nodeIndex[link.source.id];
        targetIdx = this.nodeIndex[link.target.id];
      } else {
        sourceIdx = this.nodeIndex[link.source];
        targetIdx = this.nodeIndex[link.target];
      }
      
      const sourceComm = communityMapping[this.communities[sourceIdx]];
      const targetComm = communityMapping[this.communities[targetIdx]];
      
      if (sourceComm !== targetComm) {
        const key = `${Math.min(sourceComm, targetComm)}_${Math.max(sourceComm, targetComm)}`;
        const weight = link.weight || 1;
        linkMap[key] = (linkMap[key] || 0) + weight;
      }
    });
    
    Object.keys(linkMap).forEach(key => {
      const [source, target] = key.split('_').map(Number);
      newLinks.push({
        source: `community_${source}`,
        target: `community_${target}`,
        weight: linkMap[key]
      });
    });
    
    this.nodes = newNodes;
    this.links = newLinks;
    this.nodeIndex = {};
    this.degrees = {};
    this.communities = [];
    this.m = 0;
    
    newNodes.forEach((node, i) => {
      this.nodeIndex[node.id] = i;
      this.communities[i] = i;
      this.degrees[i] = 0;
    });
    
    newLinks.forEach(link => {
      const sourceIdx = this.nodeIndex[link.source];
      const targetIdx = this.nodeIndex[link.target];
      const weight = link.weight || 1;
      this.degrees[sourceIdx] += weight;
      this.degrees[targetIdx] += weight;
      this.m += weight;
    });
  }

  _getCommunities() {
    const communityMap = {};
    const finalCommunities = {};
    
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const community = this.communities[i];
      
      if (node.originalNodes) {
        node.originalNodes.forEach(origNode => {
          if (!communityMap[community]) {
            communityMap[community] = [];
          }
          communityMap[community].push(origNode.id);
          finalCommunities[origNode.id] = community;
        });
      } else {
        if (!communityMap[community]) {
          communityMap[community] = [];
        }
        communityMap[community].push(node.id);
        finalCommunities[node.id] = community;
      }
    }
    
    return finalCommunities;
  }
}

async function parseGraphFile(filepath, extension) {
  return new Promise((resolve, reject) => {
    const nodes = new Map();
    const links = [];
    
    if (extension === '.csv') {
      const isEdgeFile = (line) => {
        const headers = Object.keys(line);
        return headers.some(h => 
          ['source', 'target', 'from', 'to', 'node1', 'node2'].includes(h.toLowerCase())
        );
      };
      
      let firstLine = null;
      let isEdge = false;
      
      fs.createReadStream(filepath)
        .pipe(csv())
        .on('data', (row) => {
          if (!firstLine) {
            firstLine = row;
            isEdge = isEdgeFile(row);
          }
          
          if (isEdge) {
            const source = row.source || row.Source || row.from || row.From || row.node1;
            const target = row.target || row.Target || row.to || row.To || row.node2;
            const weight = row.weight ? parseFloat(row.weight) : 1;
            
            if (source && target) {
              if (!nodes.has(source)) nodes.set(source, { id: source, properties: {} });
              if (!nodes.has(target)) nodes.set(target, { id: target, properties: {} });
              
              links.push({ source, target, weight });
            }
          } else {
            const id = row.id || row.Id || row.node || row.Node || row.name;
            if (id) {
              if (!nodes.has(id)) nodes.set(id, { id: id, properties: {} });
              
              Object.keys(row).forEach(key => {
                if (key !== 'id' && key !== 'Id' && key !== 'node' && key !== 'Node' && key !== 'name') {
                  nodes.get(id).properties[key] = row[key];
                }
              });
            }
          }
        })
        .on('end', () => {
          resolve({
            nodes: Array.from(nodes.values()),
            links: links
          });
        })
        .on('error', reject);
    } else if (extension === '.json') {
      fs.readJson(filepath, (err, data) => {
        if (err) return reject(err);
        
        if (data.nodes && data.links) {
          resolve(data);
        } else if (data.nodes && data.edges) {
          resolve({
            nodes: data.nodes,
            links: data.edges
          });
        } else {
          reject(new Error('Invalid JSON format. Expected nodes and links/edges.'));
        }
      });
    } else {
      reject(new Error('Unsupported file format'));
    }
  });
}

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!['.csv', '.json'].includes(ext)) {
      await fs.remove(req.file.path);
      return res.status(400).json({ error: 'Unsupported file format. Please use CSV or JSON.' });
    }
    
    const graph = await parseGraphFile(req.file.path, ext);
    
    if (!graph.nodes || graph.nodes.length === 0) {
      return res.status(400).json({ error: 'No nodes found in the file' });
    }
    
    const louvain = new LouvainCommunityDetection(graph);
    const nodeCommunities = louvain.detect();
    
    const result = {
      nodes: graph.nodes.map(node => ({
        ...node,
        community: nodeCommunities[node.id]
      })),
      links: graph.links,
      statistics: {
        nodeCount: graph.nodes.length,
        linkCount: graph.links.length,
        communityCount: [...new Set(Object.values(nodeCommunities))].length
      }
    };
    
    await fs.remove(req.file.path);
    res.json(result);
    
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({ error: 'Error processing file: ' + error.message });
  }
});

app.post('/api/llm/test', async (req, res) => {
  try {
    const { baseUrl, apiKey, modelName } = req.body;
    
    if (!baseUrl || !apiKey) {
      return res.status(400).json({ error: 'Base URL and API Key are required' });
    }
    
    const model = modelName || 'gpt-3.5-turbo';
    
    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model: model,
        messages: [{ role: 'user', content: 'Hello, please respond with "OK"' }],
        max_tokens: 10
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    
    if (response.data && response.data.choices && response.data.choices.length > 0) {
      res.json({
        success: true,
        message: 'Connection successful',
        response: response.data.choices[0].message.content
      });
    } else {
      res.json({
        success: false,
        message: 'Unexpected response format from API'
      });
    }
    
  } catch (error) {
    console.error('LLM connection error:', error.message);
    res.json({
      success: false,
      message: error.message || 'Connection failed'
    });
  }
});

app.post('/api/llm/analyze', async (req, res) => {
  try {
    const { baseUrl, apiKey, modelName, graphData, prompt } = req.body;
    
    if (!baseUrl || !apiKey) {
      return res.status(400).json({ error: 'Base URL and API Key are required' });
    }
    
    const model = modelName || 'gpt-3.5-turbo';
    
    const statisticsText = `
Graph Statistics:
- Number of nodes: ${graphData.statistics?.nodeCount || 'N/A'}
- Number of edges: ${graphData.statistics?.linkCount || 'N/A'}
- Number of communities: ${graphData.statistics?.communityCount || 'N/A'}

${prompt}
    `.trim();
    
    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model: model,
        messages: [
          { 
            role: 'system', 
            content: 'You are a graph data analysis assistant. Help users analyze and understand their network data.' 
          },
          { role: 'user', content: statisticsText }
        ],
        max_tokens: 1000
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    
    if (response.data && response.data.choices && response.data.choices.length > 0) {
      res.json({
        success: true,
        content: response.data.choices[0].message.content
      });
    } else {
      res.status(500).json({ error: 'Unexpected response format' });
    }
    
  } catch (error) {
    console.error('LLM analysis error:', error.message);
    res.status(500).json({ error: error.message || 'Analysis failed' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`TopoVis server running on http://localhost:${PORT}`);
});
