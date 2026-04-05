class LZ77Visualizer {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.searchBufferSize = options.searchBufferSize || 8;
        this.lookaheadBufferSize = options.lookaheadBufferSize || 6;
        this.inputString = options.initialText || "abracadabradabracadabra";
        this.currentIndex = 0;
        this.tokens = [];
        this.autoStepInterval = null;
        this.lzssMode = false;
        this.onTokensUpdate = null; // callback to feed decoder

        this.renderShell();
        this.setupEventListeners();
        this.reset();
    }

    renderShell() {
        this.container.innerHTML = `
            <div class="controls-bar" style="margin-bottom: 1rem;">
                <input type="text" class="input-text" id="lz77-input" value="${this.inputString}" placeholder="Enter text to compress..." style="width: 100%;">
            </div>
            <div class="controls-bar" style="margin-bottom: 2rem; justify-content: space-between;">
                <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
                    <label>Search: <input type="number" id="lz77-search-size" class="input-text" style="width:60px; min-width:0; padding:0.5rem" value="${this.searchBufferSize}"></label>
                    <label>Lookahead: <input type="number" id="lz77-lookahead-size" class="input-text" style="width:60px; min-width:0; padding:0.5rem" value="${this.lookaheadBufferSize}"></label>
                    <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;" title="Enable LZSS: output literal chars for short matches or standalone &lt;offset,length&gt; pointers.">
                        <input type="checkbox" id="lz77-lzss-toggle" style="width:18px;height:18px;"> LZSS Mode
                    </label>
                </div>
                <div style="display: flex; gap: 1rem;">
                    <button class="btn" id="lz77-btn-reset">Reset</button>
                    <button class="btn" id="lz77-btn-step">Step</button>
                    <button class="btn btn-secondary" id="lz77-btn-auto">Auto Play</button>
                </div>
            </div>
            
            <div class="legend">
                <div class="legend-item"><div class="legend-color" style="background: rgba(139, 92, 246, 0.5)"></div> Search Buffer</div>
                <div class="legend-item"><div class="legend-color" style="background: rgba(59, 130, 246, 0.5)"></div> Lookahead Buffer</div>
                <div class="legend-item"><div class="legend-color" style="background: rgba(16, 185, 129, 0.5)"></div> Matched</div>
            </div>

            <div class="vis-container">
                <div class="string-view" id="lz77-string-view"></div>
                <div class="data-panel">
                    <h3>Encoded Output Stream (Tokens)</h3>
                    <div class="output-stream" id="lz77-output"></div>
                </div>
            </div>
        `;

        this.stringView = this.container.querySelector('#lz77-string-view');
        this.outputView = this.container.querySelector('#lz77-output');
        this.inputEl = this.container.querySelector('#lz77-input');
        this.btnReset = this.container.querySelector('#lz77-btn-reset');
        this.btnStep = this.container.querySelector('#lz77-btn-step');
        this.btnAuto = this.container.querySelector('#lz77-btn-auto');
        this.searchSizeEl = this.container.querySelector('#lz77-search-size');
        this.lookaheadSizeEl = this.container.querySelector('#lz77-lookahead-size');
        this.lzssToggle = this.container.querySelector('#lz77-lzss-toggle');
    }

    setupEventListeners() {
        this.btnReset.addEventListener('click', () => {
            this.inputString = this.inputEl.value;
            this.reset();
        });
        this.btnStep.addEventListener('click', () => this.step());
        this.btnAuto.addEventListener('click', () => this.toggleAutoStep());
        this.inputEl.addEventListener('change', (e) => {
            this.inputString = e.target.value;
            this.reset();
        });
        this.searchSizeEl.addEventListener('change', (e) => {
            this.searchBufferSize = parseInt(e.target.value) || 8;
            this.reset();
        });
        this.lookaheadSizeEl.addEventListener('change', (e) => {
            this.lookaheadBufferSize = parseInt(e.target.value) || 6;
            this.reset();
        });
        this.lzssToggle.addEventListener('change', (e) => {
            this.lzssMode = e.target.checked;
            this.reset();
        });
    }

    reset() {
        this.stopAutoStep();
        this.currentIndex = 0;
        this.tokens = [];
        this.btnStep.disabled = false;
        if (this.inputString.length === 0) this.btnStep.disabled = true;
        this.renderState();
        if(this.onTokensUpdate) this.onTokensUpdate([]);
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
        this.btnAuto.innerText = "Auto Play";
        this.btnAuto.classList.add('btn-secondary');
    }

    step() {
        if (this.currentIndex >= this.inputString.length) return;

        let bestOffset = 0;
        let bestLength = 0;

        let searchStart = Math.max(0, this.currentIndex - this.searchBufferSize);
        
        let searchBuffer = this.inputString.substring(searchStart, this.currentIndex);
        
        for (let i = 0; i < searchBuffer.length; i++) {
            let length = 0;
            // LZ77 allows length to exceed buffer if repeating pattern from search buffer
            while(
                (this.currentIndex + length) < this.inputString.length &&
                ((this.lzssMode) ? length < this.lookaheadBufferSize : length < this.lookaheadBufferSize - 1) &&
                this.inputString[searchStart + i + length] === this.inputString[this.currentIndex + length]
            ) {
                length++;
            }
            if (length > bestLength) {
                bestLength = length;
                bestOffset = this.currentIndex - (searchStart + i);
            }
        }

        let consumedLength = 0;
        let token = null;

        if (this.lzssMode) {
            if (bestLength > 1) { // 2 or more characters -> worth compressing
                token = { mode: 'lzss', type: 'pointer', offset: bestOffset, length: bestLength };
                consumedLength = bestLength;
            } else {
                let char = this.inputString[this.currentIndex];
                token = { mode: 'lzss', type: 'literal', char: char };
                bestLength = 1; // for highlighting
                bestOffset = 0; // no match highlight
                consumedLength = 1;
            }
        } else {
            let nextCharIndex = this.currentIndex + bestLength;
            let nextChar = nextCharIndex < this.inputString.length ? this.inputString[nextCharIndex] : '';
            token = { mode: 'lz77', offset: bestOffset, length: bestLength, char: nextChar };
            consumedLength = bestLength + 1;
        }

        let matchStart = bestLength > (this.lzssMode && token.type === 'literal' ? 1 : 0) ? this.currentIndex - bestOffset : -1;
        
        this.tokens.push(token);
        
        this.renderState({
            matchStart: matchStart,
            matchLength: bestLength,
            targetStart: this.currentIndex,
            targetLength: consumedLength
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
        this.outputView.innerHTML = '';

        let searchStart = Math.max(0, this.currentIndex - this.searchBufferSize);
        let lookaheadEnd = Math.min(this.inputString.length, this.currentIndex + this.lookaheadBufferSize);

        for (let i = 0; i < this.inputString.length; i++) {
            let char = this.inputString[i];
            let cell = document.createElement('div');
            cell.className = 'char-cell';
            cell.innerText = char;

            if (i >= searchStart && i < this.currentIndex) {
                cell.classList.add('search-buffer');
            }
            if (i >= this.currentIndex && i < lookaheadEnd) {
                cell.classList.add('lookahead-buffer');
            }

            if (highlightInfo) {
                if (highlightInfo.matchStart !== -1 && i >= highlightInfo.matchStart && i < highlightInfo.matchStart + highlightInfo.matchLength) {
                    cell.classList.add('matched');
                }
                if (i >= highlightInfo.targetStart && i < highlightInfo.targetStart + highlightInfo.targetLength) {
                    cell.classList.add('current-target');
                }
            }

            this.stringView.appendChild(cell);
        }

        this.tokens.forEach(t => {
            let tk = document.createElement('div');
            tk.className = 'token';
            if (t.mode === 'lzss') {
                if(t.type === 'literal') tk.innerHTML = `<span class="token-char">'${t.char === ' ' ? '␣' : t.char}'</span>`;
                else tk.innerHTML = `&lt;<span class="token-index">${t.offset}</span>, <span class="token-length">${t.length}</span>&gt;`;
            } else {
                let chDisplay = t.char === '' ? 'EOF' : (t.char === ' ' ? '␣' : t.char);
                tk.innerHTML = `&lt;<span class="token-index">${t.offset}</span>, <span class="token-length">${t.length}</span>, <span class="token-char">'${chDisplay}'</span>&gt;`;
            }
            this.outputView.appendChild(tk);
        });
        this.outputView.scrollTop = this.outputView.scrollHeight;
    }
}

class LZ77DecoderVisualizer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.inputTokens = [];
        this.currentTokenIndex = 0;
        this.reconstructedString = "";
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
                        <input type="text" id="lz77-dec-input" class="input-text" placeholder="e.g. &lt;0,0,a&gt; &lt;1,2,b&gt; or 'a' &lt;1,2&gt;" style="flex:1;">
                        <button class="btn btn-secondary" id="lz77-dec-btn-load">Load</button>
                    </div>
                </div>
                <div style="display:flex; gap:1rem;">
                    <button class="btn" id="lz77-dec-btn-reset">Reset</button>
                    <button class="btn" id="lz77-dec-btn-step">Step Decoder</button>
                    <button class="btn btn-secondary" id="lz77-dec-btn-auto">Auto Decode</button>
                </div>
            </div>
            
            <div class="vis-container">
                <div class="data-panel" style="flex: none;">
                    <h3>Incoming Token Stream</h3>
                    <div class="output-stream" id="lz77-dec-tokens" style="min-height: 40px; max-height:80px; overflow-y:auto;">Waiting for tokens...</div>
                </div>

                <div class="data-panel">
                    <h3>Reconstructed String</h3>
                    <div class="string-view" id="lz77-dec-string-view" style="min-height:4rem; flex-wrap:wrap;"></div>
                </div>
            </div>
        `;

        this.tokensView = this.container.querySelector('#lz77-dec-tokens');
        this.stringView = this.container.querySelector('#lz77-dec-string-view');
        this.btnReset = this.container.querySelector('#lz77-dec-btn-reset');
        this.btnStep = this.container.querySelector('#lz77-dec-btn-step');
        this.btnAuto = this.container.querySelector('#lz77-dec-btn-auto');
    }

    setupEventListeners() {
        this.btnReset.addEventListener('click', () => this.reset());
        this.btnStep.addEventListener('click', () => this.step());
        this.btnAuto.addEventListener('click', () => this.toggleAutoStep());

        this.btnLoad = this.container.querySelector('#lz77-dec-btn-load');
        this.customInput = this.container.querySelector('#lz77-dec-input');
        
        this.btnLoad.addEventListener('click', () => {
            const val = this.customInput.value;
            const tokenRegex = /<(\d+),\s*(\d+)(?:,\s*([^>]))?>|'([^'])'/g;
            let match;
            let parsedTokens = [];
            while ((match = tokenRegex.exec(val)) !== null) {
                if (match[4] !== undefined) {
                    parsedTokens.push({ mode: 'lzss', type: 'literal', char: match[4] });
                } else {
                    let o = parseInt(match[1]);
                    let l = parseInt(match[2]);
                    let c = match[3] === undefined ? '' : match[3];
                    if (c === '' && this.customInput.value.indexOf(match[0]) > -1) {
                        // might legitimately be missing char or empty char.
                        // if length matches standard lz77 string "<o,l,>" vs "<o,l>"
                        if (match[0].includes(',>')) {
                            parsedTokens.push({ mode: 'lz77', offset: o, length: l, char: '' });
                        } else if (match[0].split(',').length === 2) {
                            parsedTokens.push({ mode: 'lzss', type: 'pointer', offset: o, length: l });
                        } else {
                            parsedTokens.push({ mode: 'lz77', offset: o, length: l, char: c });
                        }
                    } else {
                        parsedTokens.push({ mode: 'lz77', offset: o, length: l, char: c });
                    }
                }
            }
            if (parsedTokens.length > 0) this.setTokens(parsedTokens);
        });
    }

    reset() {
        this.stopAutoStep();
        this.currentTokenIndex = 0;
        this.reconstructedString = "";
        this.btnStep.disabled = false;
        if (this.inputTokens.length === 0) this.btnStep.disabled = true;
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
            }, 400);
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

    async step() {
        if (this.isAnimating) return;
        if (this.currentTokenIndex >= this.inputTokens.length) return;
        
        this.isAnimating = true;
        this.btnStep.disabled = true;

        let t = this.inputTokens[this.currentTokenIndex];
        
        // Re-render to show active token highlight immediately
        this.renderState();

        let appended = "";
        
        let needsScan = (t.mode === 'lzss' && t.type !== 'literal') || (t.mode !== 'lzss' && t.offset > 0);
        
        if (needsScan) {
            let speed = this.autoStepInterval ? 100 : 250;
            // Animate scanning backwards
            for (let i = 0; i <= t.offset; i++) {
                let startOut = this.reconstructedString.length - i;
                this.renderState({ scanStart: startOut, scanLength: t.length });
                await new Promise(r => setTimeout(r, speed));
            }
        }

        if (t.mode === 'lzss') {
            if (t.type === 'literal') {
                appended = t.char;
                this.reconstructedString += appended;
            } else {
                let startOut = this.reconstructedString.length - t.offset;
                for(let i=0; i<t.length; i++) {
                    let char = this.reconstructedString[startOut + i];
                    appended += char;
                    this.reconstructedString += char;
                }
            }
        } else {
            let startOut = this.reconstructedString.length - t.offset;
            for(let i=0; i<t.length; i++) {
                let char = this.reconstructedString[startOut + i];
                appended += char;
                this.reconstructedString += char;
            }
            if (t.char !== '') {
                appended += t.char;
                this.reconstructedString += t.char;
            }
        }
        
        this.currentTokenIndex++;
        
        this.renderState({ appendedLength: appended.length });

        this.isAnimating = false;
        
        if (this.currentTokenIndex >= this.inputTokens.length) {
            this.btnStep.disabled = true;
            this.stopAutoStep();
        } else {
            this.btnStep.disabled = false;
        }
    }

    renderState(highlightInfo = null) {
        this.tokensView.innerHTML = '';
        this.stringView.innerHTML = '';

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
                 // scroll into view smoothly
                 setTimeout(() => tk.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
            } else if (idx < this.currentTokenIndex) {
                 tk.style.opacity = "0.7";
            }

            if (t.mode === 'lzss') {
                if(t.type === 'literal') tk.innerHTML = `<span class="token-char">'${t.char === ' ' ? '␣' : t.char}'</span>`;
                else tk.innerHTML = `&lt;<span class="token-index">${t.offset}</span>, <span class="token-length">${t.length}</span>&gt;`;
            } else {
                let chDisplay = t.char === '' ? 'EOF' : (t.char === ' ' ? '␣' : t.char);
                tk.innerHTML = `&lt;<span class="token-index">${t.offset}</span>, <span class="token-length">${t.length}</span>, <span class="token-char">'${chDisplay}'</span>&gt;`;
            }
            this.tokensView.appendChild(tk);
        });

        // Render String
        for (let i = 0; i < this.reconstructedString.length; i++) {
            let char = this.reconstructedString[i];
            let cell = document.createElement('div');
            cell.className = 'char-cell';
            cell.innerText = char;

            if (highlightInfo && highlightInfo.appendedLength && i >= this.reconstructedString.length - highlightInfo.appendedLength) {
                cell.classList.add('matched');
                setTimeout(() => cell.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
            }

            if (highlightInfo && highlightInfo.scanStart !== undefined) {
                if (i >= highlightInfo.scanStart && i < highlightInfo.scanStart + highlightInfo.scanLength) {
                    cell.style.background = "rgba(139, 92, 246, 0.4)";
                    cell.style.borderBottomColor = "var(--accent-purple)";
                    cell.style.transform = "scale(1.1)";
                    cell.style.zIndex = "1";
                    
                    // Emulate the flying text numbers used in the repo:
                    if (i === highlightInfo.scanStart) {
                        let offsetValue = this.reconstructedString.length - highlightInfo.scanStart;
                        let lbl = document.createElement("div");
                        lbl.style.position = "absolute";
                        lbl.style.top = "-20px";
                        lbl.style.left = "0";
                        lbl.style.fontSize = "0.7rem";
                        lbl.style.color = "var(--accent-purple)";
                        lbl.innerText = offsetValue;
                        cell.appendChild(lbl);
                    }
                }
            }

            this.stringView.appendChild(cell);
        }
    }
}
