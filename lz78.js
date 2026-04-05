class LZ78TrieNode {
    constructor(id, char, parentId = null) {
        this.id = id;
        this.char = char;
        this.parentId = parentId;
        this.children = {};
        this.x = 0;
        this.y = 0;
    }
}

class LZ78Visualizer {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.inputString = options.initialText || "abracadabradabracadabra";
        this.currentIndex = 0;
        
        this.autoStepInterval = null;
        this.zoomScale = 1.0;
        this.onTokensUpdate = null; // callback to feed decoder

        this.renderShell();
        this.setupEventListeners();
        this.reset();
    }

    renderShell() {
        this.container.innerHTML = `
            <div class="controls-bar" style="margin-bottom: 1rem;">
                <input type="text" class="input-text" id="lz78-input" value="${this.inputString}" placeholder="Enter text to compress..." style="width: 100%;">
            </div>
            <div class="controls-bar" style="margin-bottom: 2rem;">
                <button class="btn" id="lz78-btn-reset">Reset</button>
                <button class="btn" id="lz78-btn-prev" disabled>Previous</button>
                <button class="btn" id="lz78-btn-step">Step</button>
                <button class="btn btn-secondary" id="lz78-btn-auto">Auto Play</button>
            </div>

            <div class="vis-container">
                <div class="string-view" id="lz78-string-view"></div>
                
                <div class="lz78-layout">
                    <div class="dictionary-panel">
                        <h3>Dictionary Table</h3>
                        <div style="max-height: 300px; overflow-y: auto;">
                            <table class="dict-table" id="lz78-dict-table">
                                <thead>
                                    <tr>
                                        <th style="width: 50px;">Idx</th>
                                        <th>Tuple</th>
                                        <th>String</th>
                                    </tr>
                                </thead>
                                <tbody></tbody>
                            </table>
                        </div>
                    </div>

                    <div class="tree-panel">
                        <h3>Trie View <span style="float:right; font-size: 0.8rem; font-weight: normal; color: var(--text-secondary)">(Scroll to zoom)</span></h3>
                        <div class="tree-container" id="lz78-tree-container">
                            <svg width="100%" height="100%" id="lz78-svg"></svg>
                        </div>
                    </div>
                </div>

                <div class="data-panel">
                    <h3>Encoded Output Stream (Tokens)</h3>
                    <div class="output-stream" id="lz78-output"></div>
                </div>
            </div>
        `;

        this.stringView = this.container.querySelector('#lz78-string-view');
        this.outputView = this.container.querySelector('#lz78-output');
        this.dictTbody = this.container.querySelector('#lz78-dict-table tbody');
        this.svg = this.container.querySelector('#lz78-svg');
        this.treeContainer = this.container.querySelector('#lz78-tree-container');

        this.inputEl = this.container.querySelector('#lz78-input');
        this.btnReset = this.container.querySelector('#lz78-btn-reset');
        this.btnPrev = this.container.querySelector('#lz78-btn-prev');
        this.btnStep = this.container.querySelector('#lz78-btn-step');
        this.btnAuto = this.container.querySelector('#lz78-btn-auto');
    }

    setupEventListeners() {
        this.btnReset.addEventListener('click', () => {
            this.inputString = this.inputEl.value;
            this.reset();
        });
        this.btnPrev.addEventListener('click', () => this.previous());
        this.btnStep.addEventListener('click', () => this.step());
        this.btnAuto.addEventListener('click', () => this.toggleAutoStep());
        this.inputEl.addEventListener('change', (e) => {
            this.inputString = e.target.value;
            this.reset();
        });
        
        this.svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) {
                this.zoomScale *= 1.1;
            } else {
                this.zoomScale *= 0.9;
            }
            this.renderTree(this.lastActiveNodeId || -1);
        }, { passive: false });
    }

    reset() {
        this.stopAutoStep();
        this.currentIndex = 0;
        
        // Data Structures
        this.dictionary = [''];
        this.tokens = [];
        this.nodes = { 0: new LZ78TrieNode(0, 'root') };
        
        this.history = [];
        this.btnPrev.disabled = true;

        this.btnStep.disabled = false;
        if(this.inputString.length === 0) this.btnStep.disabled = true;
        
        this.renderState();
        if(this.onTokensUpdate) this.onTokensUpdate([]);
    }

    previous() {
        if (this.history.length === 0) return;
        let state = this.history.pop();
        this.currentIndex = state.currentIndex;
        this.tokens = state.tokens;
        this.dictionary = state.dictionary;
        this.nodes = state.nodes;
        
        this.btnStep.disabled = false;
        if (this.history.length === 0) this.btnPrev.disabled = true;
        
        this.renderState();
        if(this.onTokensUpdate) this.onTokensUpdate(this.tokens);
    }

    toggleAutoStep() {
        if (this.autoStepInterval) {
            this.stopAutoStep();
        } else {
            this.autoStepInterval = setInterval(() => {
                if (this.currentIndex >= this.inputString.length) {
                    this.stopAutoStep();
                } else {
                    this.step();
                }
            }, 800);
            this.btnAuto.innerText = "Stop Auto";
            this.btnAuto.classList.remove('btn-secondary');
        }
    }

    stopAutoStep() {
        if (this.autoStepInterval) {
            clearInterval(this.autoStepInterval);
            this.autoStepInterval = null;
        }
        this.btnAuto.innerText = "Auto Play";
        this.btnAuto.classList.add('btn-secondary');
    }

    step() {
        if (this.currentIndex >= this.inputString.length) return;

        this.history.push({
            currentIndex: this.currentIndex,
            tokens: JSON.parse(JSON.stringify(this.tokens)),
            dictionary: JSON.parse(JSON.stringify(this.dictionary)),
            nodes: JSON.parse(JSON.stringify(this.nodes))
        });
        this.btnPrev.disabled = false;

        let currentNodeId = 0;
        let matchLen = 0;

        // Traverse the trie
        while (
            this.currentIndex + matchLen < this.inputString.length &&
            this.nodes[currentNodeId].children[this.inputString[this.currentIndex + matchLen]] !== undefined
        ) {
            let ch = this.inputString[this.currentIndex + matchLen];
            currentNodeId = this.nodes[currentNodeId].children[ch];
            matchLen++;
        }

        let nextCharIndex = this.currentIndex + matchLen;
        let nextChar = nextCharIndex < this.inputString.length ? this.inputString[nextCharIndex] : '';
        
        // Output Token
        let token = {
            index: currentNodeId,
            char: nextChar
        };
        this.tokens.push(token);

        // Add to Dictionary
        let newEntryStr = this.dictionary[currentNodeId] + nextChar;
        let newIdx = this.dictionary.length;
        this.dictionary.push(newEntryStr);

        // Add to Trie
        let newNode = new LZ78TrieNode(newIdx, nextChar, currentNodeId);
        this.nodes[newIdx] = newNode;
        if (nextChar !== '') {
            this.nodes[currentNodeId].children[nextChar] = newIdx;
        }

        let consumedLength = matchLen + (nextChar !== '' ? 1 : 0);
        
        this.renderState({
            matchStart: this.currentIndex,
            matchLength: consumedLength,
            justAddedIndex: newIdx
        });

        this.currentIndex += consumedLength;

        if(this.onTokensUpdate) this.onTokensUpdate(this.tokens);

        if (this.currentIndex >= this.inputString.length) {
            this.btnStep.disabled = true;
            this.stopAutoStep();
        }
    }

    renderState(highlightInfo = null) {
        this.stringView.innerHTML = '';
        this.dictTbody.innerHTML = '';
        this.outputView.innerHTML = '';

        // 1. Render String
        for (let i = 0; i < this.inputString.length; i++) {
            let char = this.inputString[i];
            let cell = document.createElement('div');
            cell.className = 'char-cell';
            cell.innerText = char;

            if (i < this.currentIndex) {
               cell.style.color = "var(--text-secondary)";
            }
            if (highlightInfo) {
                if (i >= highlightInfo.matchStart && i < highlightInfo.matchStart + highlightInfo.matchLength) {
                    cell.classList.add('matched');
                }
            } else if (i === this.currentIndex) {
                cell.classList.add('current-target');
            }

            this.stringView.appendChild(cell);
        }

        // 2. Render Tokens
        this.tokens.forEach(t => {
            let tk = document.createElement('div');
            tk.className = 'token';
            let chDisplay = t.char === '' ? 'EOF' : (t.char === ' ' ? '␣' : t.char);
            tk.innerHTML = `&lt;<span class="token-index">${t.index}</span>, <span class="token-char">'${chDisplay}'</span>&gt;`;
            this.outputView.appendChild(tk);
        });
        this.outputView.scrollTop = this.outputView.scrollHeight;

        // 3. Render Dictionary Table
        for (let i = 0; i < this.dictionary.length; i++) {
            let tr = document.createElement('tr');
            if (highlightInfo && i === highlightInfo.justAddedIndex) {
                tr.classList.add('new-entry');
            }
            let tupleDisplay = i === 0 ? '<i>n/a</i>' : `(${this.nodes[i].parentId}, '${this.nodes[i].char === '' ? '' : this.nodes[i].char}')`;
            tr.innerHTML = `
                <td>${i}</td>
                <td>${tupleDisplay}</td>
                <td>${i === 0 ? '<i>&lt;empty&gt;</i>' : this.dictionary[i]}</td>
            `;
            this.dictTbody.appendChild(tr);
            
            if (highlightInfo && i === highlightInfo.justAddedIndex) {
               setTimeout(() => {
                   tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
               }, 50);
            }
        }

        // 4. Render Trie SVG
        this.lastActiveNodeId = highlightInfo ? highlightInfo.justAddedIndex : -1;
        this.renderTree(this.lastActiveNodeId);
    }

    // A very simple recursive tree layout algorithm for SVG
    renderTree(activeNodeId) {
        this.svg.innerHTML = '';

        const width = this.treeContainer.clientWidth || 400;
        const height = this.treeContainer.clientHeight || 300;
        
        let depthLevels = {};
        const getDepth = (nodeId, depth) => {
            if(!depthLevels[depth]) depthLevels[depth] = [];
            depthLevels[depth].push(nodeId);
            for(let key in this.nodes[nodeId].children) {
                getDepth(this.nodes[nodeId].children[key], depth + 1);
            }
        };
        getDepth(0, 0);

        let maxDepth = Object.keys(depthLevels).length;
        let vGap = height / (maxDepth + 1);

        let gRoot = document.createElementNS("http://www.w3.org/2000/svg", "g");
        let cx = width / 2;
        let cy = height / 2;
        gRoot.setAttribute("transform", `translate(${cx}, ${cy}) scale(${this.zoomScale}) translate(${-cx}, ${-cy})`);

        for (let d in depthLevels) {
            let nodesAtLevel = depthLevels[d];
            let hGap = width / (nodesAtLevel.length + 1);
            nodesAtLevel.forEach((nId, idx) => {
                this.nodes[nId].x = hGap * (idx + 1);
                this.nodes[nId].y = vGap * (parseInt(d) + 1);
            });
        }

        for (let id in this.nodes) {
            let n = this.nodes[id];
            if (n.parentId !== null) {
                let p = this.nodes[n.parentId];
                let line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                line.setAttribute('x1', p.x);
                line.setAttribute('y1', p.y);
                line.setAttribute('x2', n.x);
                line.setAttribute('y2', n.y);
                line.setAttribute('class', id == activeNodeId ? 'tree-link active' : 'tree-link');
                gRoot.appendChild(line);
            }
        }

        for (let id in this.nodes) {
            let n = this.nodes[id];
            let g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            g.setAttribute('class', id == activeNodeId ? 'tree-node active tree-node-group' : 'tree-node tree-node-group');
            g.style.transform = `translate(${n.x}px, ${n.y}px)`;

            let circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute('r', 16);
            
            let text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.textContent = n.char === 'root' ? 'R' : n.char;
            
            g.appendChild(circle);
            g.appendChild(text);

            let idxText = document.createElementNS("http://www.w3.org/2000/svg", "text");
            idxText.textContent = id;
            idxText.setAttribute('y', 26);
            idxText.setAttribute('fill', 'var(--text-secondary)');
            idxText.setAttribute('font-size', '10px');
            g.appendChild(idxText);

            gRoot.appendChild(g);
        }
        
        this.svg.appendChild(gRoot);
    }
}

class LZ78DecoderVisualizer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.inputTokens = [];
        this.currentTokenIndex = 0;
        
        this.reconstructedString = "";
        this.dictionary = [''];
        
        this.autoStepInterval = null;

        this.renderShell();
        this.setupEventListeners();
    }

    setTokens(tokens) {
        this.inputTokens = tokens;
        this.reset();
    }

    renderShell() {
        this.container.innerHTML = `
            <div class="controls-bar" style="margin-bottom: 1rem; justify-content: space-between; align-items: start;">
                <div style="flex:1; display:flex; flex-direction:column; gap:0.5rem; max-width: 60%;">
                    <div style="color: var(--text-secondary); font-size: 0.9rem;">
                        Tokens are fed from the encoder automatically, or enter custom tokens below:
                    </div>
                    <div style="display:flex; gap:0.5rem;">
                        <input type="text" id="lz78-dec-input" class="input-text" placeholder="e.g. &lt;0,a&gt; &lt;1,b&gt; &lt;2,&gt;" style="flex:1;">
                        <button class="btn btn-secondary" id="lz78-dec-btn-load">Load</button>
                    </div>
                </div>
                <div style="display:flex; gap:1rem;">
                    <button class="btn" id="lz78-dec-btn-reset">Reset</button>
                    <button class="btn" id="lz78-dec-btn-prev" disabled>Previous</button>
                    <button class="btn" id="lz78-dec-btn-step">Step Decoder</button>
                    <button class="btn btn-secondary" id="lz78-dec-btn-auto">Auto Decode</button>
                </div>
            </div>
            
            <div class="vis-container">
                <div class="data-panel" style="flex: none;">
                    <h3>Incoming Token Stream</h3>
                    <div class="output-stream" id="lz78-dec-tokens" style="min-height: 40px; max-height:80px; overflow-y:auto;">Waiting for tokens...</div>
                </div>

                <div class="lz78-layout">
                    <div class="dictionary-panel">
                        <h3>Decoder Dictionary <span style="font-weight:normal; font-size:0.8rem; color:var(--text-secondary)">(Rebuilding)</span></h3>
                        <div style="max-height: 300px; overflow-y: auto;">
                            <table class="dict-table" id="lz78-dec-dict-table">
                                <thead>
                                    <tr>
                                        <th style="width: 50px;">Idx</th>
                                        <th>Tuple</th>
                                        <th>String</th>
                                    </tr>
                                </thead>
                                <tbody></tbody>
                            </table>
                        </div>
                    </div>
                    <div class="data-panel" style="display:flex; flex-direction:column;">
                        <h3>Reconstructed String</h3>
                        <div class="string-view" id="lz78-dec-string-view" style="flex:1; flex-wrap:wrap; align-content: flex-start;"></div>
                    </div>
                </div>
            </div>
        `;

        this.tokensView = this.container.querySelector('#lz78-dec-tokens');
        this.stringView = this.container.querySelector('#lz78-dec-string-view');
        this.dictTbody = this.container.querySelector('#lz78-dec-dict-table tbody');
        
        this.btnReset = this.container.querySelector('#lz78-dec-btn-reset');
        this.btnPrev = this.container.querySelector('#lz78-dec-btn-prev');
        this.btnStep = this.container.querySelector('#lz78-dec-btn-step');
        this.btnAuto = this.container.querySelector('#lz78-dec-btn-auto');
    }

    setupEventListeners() {
        this.btnReset.addEventListener('click', () => this.reset());
        this.btnPrev.addEventListener('click', () => this.previous());
        this.btnStep.addEventListener('click', () => this.step());
        this.btnAuto.addEventListener('click', () => this.toggleAutoStep());

        this.btnLoad = this.container.querySelector('#lz78-dec-btn-load');
        this.customInput = this.container.querySelector('#lz78-dec-input');
        
        this.btnLoad.addEventListener('click', () => {
            const val = this.customInput.value;
            const tokenRegex = /<(\d+),\s*([^>])?>/g;
            let match;
            let parsedTokens = [];
            while ((match = tokenRegex.exec(val)) !== null) {
                let idx = parseInt(match[1]);
                let c = match[2] === undefined ? '' : match[2];
                parsedTokens.push({ index: idx, char: c });
            }
            if (parsedTokens.length > 0) this.setTokens(parsedTokens);
        });
    }

    reset() {
        this.stopAutoStep();
        this.currentTokenIndex = 0;
        this.reconstructedString = "";
        this.dictionary = [''];
        this.dictTuples = [{parent: 0, char: ''}];
        
        this.history = [];
        this.btnPrev.disabled = true;

        this.btnStep.disabled = false;
        if (this.inputTokens.length === 0) this.btnStep.disabled = true;
        this.renderState();
    }

    previous() {
        if (this.history.length === 0) return;
        let state = this.history.pop();
        this.currentTokenIndex = state.currentTokenIndex;
        this.reconstructedString = state.reconstructedString;
        this.dictionary = state.dictionary;
        this.dictTuples = state.dictTuples;
        
        this.btnStep.disabled = false;
        if (this.history.length === 0) this.btnPrev.disabled = true;
        
        this.renderState();
    }

    toggleAutoStep() {
        if (this.autoStepInterval) {
            this.stopAutoStep();
        } else {
            this.autoStepInterval = setInterval(() => {
                if (this.currentTokenIndex >= this.inputTokens.length) {
                    this.stopAutoStep();
                } else {
                    this.step();
                }
            }, 600);
            this.btnAuto.innerText = "Stop Auto";
            this.btnAuto.classList.remove('btn-secondary');
        }
    }

    stopAutoStep() {
        if (this.autoStepInterval) {
            clearInterval(this.autoStepInterval);
            this.autoStepInterval = null;
        }
        this.btnAuto.innerText = "Auto Decode";
        this.btnAuto.classList.add('btn-secondary');
    }

    step() {
        if (this.currentTokenIndex >= this.inputTokens.length) return;
        
        this.history.push({
            currentTokenIndex: this.currentTokenIndex,
            reconstructedString: this.reconstructedString,
            dictionary: JSON.parse(JSON.stringify(this.dictionary)),
            dictTuples: JSON.parse(JSON.stringify(this.dictTuples))
        });
        this.btnPrev.disabled = false;

        let t = this.inputTokens[this.currentTokenIndex];
        
        // Reconstruct entry
        let prefix = this.dictionary[t.index];
        let newEntry = prefix + t.char;
        
        // Update string
        this.reconstructedString += newEntry;
        
        // Update dict
        let addedIdx = this.dictionary.length;
        this.dictionary.push(newEntry);
        this.dictTuples.push({parent: t.index, char: t.char});
        
        this.currentTokenIndex++;
        
        this.renderState({ appendedLength: newEntry.length, addedIdx: addedIdx });

        if (this.currentTokenIndex >= this.inputTokens.length) {
            this.btnStep.disabled = true;
            this.stopAutoStep();
        }
    }

    renderState(highlightInfo = null) {
        this.tokensView.innerHTML = '';
        this.stringView.innerHTML = '';
        this.dictTbody.innerHTML = '';

        if(this.inputTokens.length === 0) {
            this.tokensView.innerText = "No tokens recorded yet. Use Encoder above.";
            return;
        }

        // Render Tokens
        this.inputTokens.forEach((t, idx) => {
            let tk = document.createElement('div');
            tk.className = 'token';
            if (idx === this.currentTokenIndex) {
                 tk.style.boxShadow = "0 0 10px var(--accent-orange)";
                 tk.style.borderColor = "var(--accent-orange)";
                 setTimeout(() => tk.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
            } else if (idx < this.currentTokenIndex) {
                 tk.style.opacity = "0.7";
            }
            let chDisplay = t.char === '' ? 'EOF' : (t.char === ' ' ? '␣' : t.char);
            tk.innerHTML = `&lt;<span class="token-index">${t.index}</span>, <span class="token-char">'${chDisplay}'</span>&gt;`;
            this.tokensView.appendChild(tk);
        });

        // Render String
        for (let i = 0; i < this.reconstructedString.length; i++) {
            let char = this.reconstructedString[i];
            let cell = document.createElement('div');
            cell.className = 'char-cell';
            cell.innerText = char;

            if (highlightInfo && i >= this.reconstructedString.length - highlightInfo.appendedLength) {
                cell.classList.add('matched');
                setTimeout(() => cell.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
            }

            this.stringView.appendChild(cell);
        }
        
        // Render Dictionary Table
        for (let i = 0; i < this.dictionary.length; i++) {
            let tr = document.createElement('tr');
            if (highlightInfo && i === highlightInfo.addedIdx) {
                tr.classList.add('new-entry');
            }
            let tupleDisplay = i === 0 ? '<i>n/a</i>' : `(${this.dictTuples[i].parent}, '${this.dictTuples[i].char === '' ? '' : this.dictTuples[i].char}')`;
            tr.innerHTML = `
                <td>${i}</td>
                <td>${tupleDisplay}</td>
                <td>${i === 0 ? '<i>&lt;empty&gt;</i>' : this.dictionary[i]}</td>
            `;
            this.dictTbody.appendChild(tr);
            
            if (highlightInfo && i === highlightInfo.addedIdx) {
               setTimeout(() => {
                   tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
               }, 50);
            }
        }
    }
}
