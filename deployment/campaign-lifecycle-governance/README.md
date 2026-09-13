# Campaign lifecycle governance

This package adds three production safeguards:

- a calculated Campaign readiness state based on Iterations, Runs, contacts and call executions;
- Campaign completion owned exclusively by the assigned Campaign Manager;
- an immutable audit trail plus recoverable handling of provider submissions whose callback never arrives.

## Install the API changes

From the UI repository on the server:

```bash
sudo systemctl stop psephology-api.service
node deployment/campaign-lifecycle-governance/install-campaign-lifecycle.js \
  /opt/sarvam-voice-analytics
cd /opt/sarvam-voice-analytics
node src/db/migrate-campaign-lifecycle.js
node --check src/repositories/lifecycle-audit.repository.js
node --check src/repositories/campaign-lifecycle.repository.js
node --check src/repositories/stale-callback-recovery.repository.js
node --check src/repositories/run-lifecycle.repository.js
node --check src/routes/campaign-lifecycle.routes.js
node --check src/db/recover-stale-callbacks.js
node src/db/recover-stale-callbacks.js
sudo systemctl start psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 \
  http://127.0.0.1:3000/health
```

The stale-callback command is a dry run unless `--apply` is supplied. Review its
candidate table before enabling scheduled recovery.

## Enable scheduled stale-callback recovery

The default stale threshold is 30 minutes and the timer runs every five minutes.
Set `RUN_CALLBACK_STALE_MINUTES` in `/etc/psephology-api.env` to a value of at
least 15 if a different threshold is required.

From the UI repository:

```bash
sudo cp deployment/campaign-lifecycle-governance/psephology-lifecycle-recovery.service \
  /etc/systemd/system/psephology-lifecycle-recovery.service
sudo cp deployment/campaign-lifecycle-governance/psephology-lifecycle-recovery.timer \
  /etc/systemd/system/psephology-lifecycle-recovery.timer
sudo systemctl daemon-reload
sudo systemctl enable --now psephology-lifecycle-recovery.timer
sudo systemctl list-timers psephology-lifecycle-recovery.timer --no-pager
```

Inspect recovery activity with:

```bash
sudo journalctl -u psephology-lifecycle-recovery.service --since "1 hour ago" --no-pager
```
