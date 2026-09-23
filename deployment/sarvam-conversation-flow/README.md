# Concise Sarvam conversation flow

Adds a governed turn-taking instruction to every platform-launched Sarvam Run
call. After a usable voter answer, the agent must acknowledge in two to five
words and immediately ask the next approved question. It must not repeat,
paraphrase, summarize, interpret, praise or debate the answer. One short probe
is allowed only when an answer cannot be coded.

The policy is appended to the existing `agent_style_context` and
`probe_context`; it does not replace the Iteration questionnaire, consent,
language, candidate knowledge or voice-agent snapshot. The committed Sarvam
Agent App must reference both input variables in its system instructions.

Deploy on the API host before launching another call:

```bash
node deployment/sarvam-conversation-flow/test-sarvam-conversation-flow.js
node deployment/sarvam-conversation-flow/install-sarvam-conversation-flow.js \
  /opt/sarvam-voice-analytics
node --check /opt/sarvam-voice-analytics/src/services/sarvam-execution.service.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 \
  -i http://127.0.0.1:3000/ready
```

Validate with one approved demo call before bulk launch. Confirm from its AWS
transcript that answers are not echoed and all expected questions are reached.
