// App logic for the Sandbox AI Agent
const chatFeed = document.getElementById('chat-feed');
const feedContainer = document.getElementById('feed-container');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const emptyState = document.getElementById('empty-state');

const agentStatusDot = document.getElementById('agent-status-dot');
const agentStatusText = document.getElementById('agent-status-text');
const newChatBtn = document.getElementById('new-chat-btn');

// Suggestions
const suggCalc = document.getElementById('sugg-calc');
const suggFs = document.getElementById('sugg-fs');
const suggSys = document.getElementById('sugg-sys');
const suggFetch = document.getElementById('sugg-fetch');

let messageHistory = [];
let isGenerating = false;

// Auto-grow textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = (chatInput.scrollHeight) + 'px';
});

// Keypress listener
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

// Suggestions click handlers
suggCalc.addEventListener('click', () => triggerPrompt("Write a Python script to calculate the first 50 Fibonacci numbers and print them along with the execution time."));
suggFs.addEventListener('click', () => triggerPrompt("Write a Node.js script that writes systemic server configuration mock details to a 'server_config.json' file, reads it back, modifies a field, and outputs the updated config."));
suggSys.addEventListener('click', () => triggerPrompt("Run a bash command to check the CPU architecture, system uptime, and environment variables in the sandbox."));
suggFetch.addEventListener('click', () => triggerPrompt("Write a Python script that makes an HTTP request to 'https://google.com' (or a public api like JSONPlaceholder) to test network connectivity and prints the response status code and headers."));

newChatBtn.addEventListener('click', () => {
  messageHistory = [];
  // Clear feed container except emptyState
  const elements = Array.from(feedContainer.children);
  elements.forEach(el => {
    if (el !== emptyState) {
      el.remove();
    }
  });
  emptyState.style.display = 'flex';
  updateSandboxStatus(false, 'Idle');
});

function triggerPrompt(text) {
  chatInput.value = text;
  chatInput.dispatchEvent(new Event('input'));
  sendMessage();
}

function updateSandboxStatus(active, statusText = 'Idle') {
  if (active) {
    agentStatusDot.className = 'status-dot active';
    if (statusText !== 'Idle') {
      agentStatusDot.className = 'status-dot thinking';
    }
  } else {
    agentStatusDot.className = 'status-dot';
  }
  agentStatusText.textContent = statusText;
}

// Basic markdown-like text formatter
function formatMarkdown(text) {
  // Escape HTML
  let formatted = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks: ```lang\ncode\n```
  formatted = formatted.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><code class="language-${lang || 'txt'}">${code.trim()}</code></pre>`;
  });

  // Inline code: `code`
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold: **text**
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Line breaks
  formatted = formatted.replace(/\n/g, '<br>');

  return formatted;
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isGenerating) return;

  isGenerating = true;
  chatInput.value = '';
  chatInput.style.height = 'auto';
  chatInput.disabled = true;
  sendBtn.disabled = true;
  emptyState.style.display = 'none';

  // Add user message to UI
  appendUserMessage(text);
  messageHistory.push({ role: 'user', content: text });

  // Update status
  updateSandboxStatus(true, 'Thinking...');

  // Create assistant message container
  const assistantMsgEl = document.createElement('div');
  assistantMsgEl.className = 'message assistant';
  feedContainer.appendChild(assistantMsgEl);
  chatFeed.scrollTop = chatFeed.scrollHeight;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: messageHistory
      })
    });

    if (!response.ok) {
      throw new Error(`Server returned error: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let currentThinkingBlock = null;
    let currentTextBlock = null;
    let toolBlocks = {};
    let fullResponseText = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        let jsonStr = line;
        if (jsonStr.startsWith('data: ')) {
          jsonStr = jsonStr.slice(6);
        }

        try {
          const event = JSON.parse(jsonStr);
          
          switch (event.type) {
            case 'thinking':
              updateSandboxStatus(true, 'Thinking...');
              if (!currentThinkingBlock) {
                currentThinkingBlock = createThinkingBlock(assistantMsgEl);
              }
              appendThinkingContent(currentThinkingBlock, event.content);
              break;

            case 'text':
              updateSandboxStatus(true, 'Formulating Response...');
              if (!currentTextBlock) {
                currentTextBlock = createTextBlock(assistantMsgEl);
              }
              fullResponseText += event.content;
              currentTextBlock.innerHTML = formatMarkdown(fullResponseText);
              break;

            case 'tool_use':
              updateSandboxStatus(true, 'Executing Tool...');
              const toolEl = createToolBlock(assistantMsgEl, event.toolName, event.toolInput, event.toolUseId);
              toolBlocks[event.toolUseId] = toolEl;
              break;

            case 'tool_result':
              updateSandboxStatus(true, 'Processing Result...');
              const targetToolEl = toolBlocks[event.toolUseId];
              if (targetToolEl) {
                updateToolBlockResult(targetToolEl, event);
              }
              break;

            case 'error':
              createErrorBlock(assistantMsgEl, event.message);
              updateSandboxStatus(false, 'Error');
              break;

            case 'done':
              updateSandboxStatus(true, 'Idle');
              break;
          }
          chatFeed.scrollTop = chatFeed.scrollHeight;
        } catch (e) {
          console.error("Error parsing NDJSON line:", line, e);
        }
      }
    }

    if (fullResponseText) {
      messageHistory.push({ role: 'assistant', content: fullResponseText });
    }
  } catch (error) {
    console.error("Chat streaming failed:", error);
    createErrorBlock(assistantMsgEl, error.message || 'An unexpected error occurred during execution.');
    updateSandboxStatus(false, 'Error');
  } finally {
    isGenerating = false;
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

function appendUserMessage(text) {
  const msgEl = document.createElement('div');
  msgEl.className = 'message user';
  
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;
  
  msgEl.appendChild(bubble);
  feedContainer.appendChild(msgEl);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function createThinkingBlock(parent) {
  const container = document.createElement('div');
  container.className = 'thinking-block';

  const header = document.createElement('div');
  header.className = 'thinking-header';
  header.innerHTML = `
    <span>Reasoning &amp; Thoughts</span>
    <svg class="thinking-toggle-icon" viewBox="0 0 24 24">
      <path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/>
    </svg>
  `;

  const content = document.createElement('div');
  content.className = 'thinking-content';

  header.addEventListener('click', () => {
    container.classList.toggle('collapsed');
  });

  container.appendChild(header);
  container.appendChild(content);
  parent.appendChild(container);
  
  return content;
}

function appendThinkingContent(element, text) {
  element.textContent += text;
}

function createTextBlock(parent) {
  const textContainer = document.createElement('div');
  textContainer.className = 'assistant-response-text';
  parent.appendChild(textContainer);
  return textContainer;
}

function createToolBlock(parent, toolName, toolInput, toolUseId) {
  const container = document.createElement('div');
  container.className = 'tool-block';
  container.dataset.toolUseId = toolUseId;
  container.dataset.toolName = toolName;

  let contentText = '';
  let subTitle = '';
  if (toolName === 'run_code') {
    contentText = toolInput.code || '';
    subTitle = `Run Code (${toolInput.language || 'python'})`;
  } else if (toolName === 'run_command') {
    contentText = toolInput.command || '';
    subTitle = 'Run Shell Command';
  } else if (toolName === 'write_file') {
    contentText = `Path: ${toolInput.path}\n\nContent:\n${toolInput.content || ''}`;
    subTitle = 'Write File to Sandbox';
  } else if (toolName === 'read_file') {
    contentText = `Path: ${toolInput.path}`;
    subTitle = 'Read File from Sandbox';
  } else if (toolName === 'export_file') {
    contentText = `Path: ${toolInput.path}`;
    subTitle = 'Export File from Sandbox';
  } else {
    contentText = JSON.stringify(toolInput, null, 2);
    subTitle = `Tool Use: ${toolName}`;
  }

  container.innerHTML = `
    <div class="tool-header">
      <div class="tool-badge running">
        <svg class="tool-icon" viewBox="0 0 24 24">
          <path d="M19,3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3M19,19H5V5H19V19M8,17H16V15H8V17M16,7H8V9H16V7M8,13H16V11H8V13Z"/>
        </svg>
        <span>${subTitle}</span>
      </div>
      <span class="tool-status">Running in sandbox...</span>
    </div>
    <div class="tool-code-wrapper">
      <div class="tool-code">${escapeHtml(contentText)}</div>
    </div>
  `;

  parent.appendChild(container);
  return container;
}

function updateToolBlockResult(toolEl, result) {
  const headerBadge = toolEl.querySelector('.tool-badge');
  const statusSpan = toolEl.querySelector('.tool-status');
  
  if (headerBadge) {
    headerBadge.className = 'tool-badge';
  }
  
  if (result.exitCode === 0) {
    statusSpan.textContent = 'Completed';
    statusSpan.style.color = 'var(--success)';
  } else {
    statusSpan.textContent = `Exit Code ${result.exitCode !== null ? result.exitCode : 'Unknown'}`;
    statusSpan.style.color = 'var(--error)';
  }

  // Add output pane
  const outputContainer = document.createElement('div');
  outputContainer.className = 'tool-output';

  let hasOutput = false;
  let html = `<div class="output-title">Sandbox Console</div>`;

  if (result.stdout && result.stdout.trim()) {
    html += `<pre class="output-console">${escapeHtml(result.stdout)}</pre>`;
    hasOutput = true;
  }
  
  if (result.stderr && result.stderr.trim()) {
    html += `<div class="output-title" style="margin-top: 0.75rem; color: var(--error)">Error Log</div>`;
    html += `<pre class="output-console error">${escapeHtml(result.stderr)}</pre>`;
    hasOutput = true;
  }

  if (result.error) {
    html += `<div class="output-title" style="margin-top: 0.75rem; color: var(--error)">Execution Exception</div>`;
    html += `<pre class="output-console error">${escapeHtml(result.error)}</pre>`;
    hasOutput = true;
  }

  if (!hasOutput) {
    html += `<pre class="output-console" style="color: var(--text-muted); font-style: italic;">(No output produced)</pre>`;
  }

  // Meta
  html += `
    <div class="output-meta">
      <span>Status: ${result.exitCode === 0 ? 'Success' : 'Failed'}</span>
      <span>Exit Code: ${result.exitCode !== null ? result.exitCode : 'None'}</span>
    </div>
  `;

  outputContainer.innerHTML = html;
  toolEl.appendChild(outputContainer);

  // Special UI for export_file tool
  if (toolEl.dataset.toolName === 'export_file' && result.exitCode === 0) {
    try {
      const exportData = JSON.parse(result.stdout);
      const exportCard = document.createElement('div');
      exportCard.className = 'export-card';
      
      const kbSize = (exportData.size / 1024).toFixed(1);
      
      exportCard.innerHTML = `
        <div class="export-info">
          <div class="export-icon-wrapper">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
          </div>
          <div class="export-details">
            <span class="export-filename">${escapeHtml(exportData.filename)}</span>
            <span class="export-meta">Sandbox Export • ${kbSize} KB</span>
          </div>
        </div>
        <a href="${exportData.downloadUrl}" download="${exportData.filename}" class="export-download-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Download
        </a>
      `;
      toolEl.appendChild(exportCard);
    } catch (e) {
      console.error("Error parsing export_file response JSON", e);
    }
  }
}

function createErrorBlock(parent, message) {
  const container = document.createElement('div');
  container.className = 'tool-block';
  container.style.borderColor = 'var(--error)';
  
  container.innerHTML = `
    <div class="tool-header" style="background-color: rgba(239, 68, 68, 0.05);">
      <div class="tool-badge" style="color: var(--error);">
        <svg class="tool-icon" viewBox="0 0 24 24">
          <path d="M11,15H13V17H11V15M11,7H13V13H11V7M12,2C6.47,2 2,6.5 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20Z"/>
        </svg>
        <span>Error Occurred</span>
      </div>
    </div>
    <div style="padding: 1rem; color: var(--error); font-size: 0.9rem; font-family: monospace; white-space: pre-wrap; background-color: rgba(239, 68, 68, 0.02);">
      ${escapeHtml(message)}
    </div>
  `;
  
  parent.appendChild(container);
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
