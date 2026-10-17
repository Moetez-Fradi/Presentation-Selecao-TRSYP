# Pitch script — 5 minutes

About 650 words. **[→]** = press next (a click inside a slide or the next slide).
Start the live dose on slide 8 and let it run while you talk through slides 9–16.

---

**1 · Title (0:00)**
Good morning. We built an automated weighing and dosing station, where every action is decided by the measured weight.

**2 · Manual dosing today (0:10)**
Today, dosing a powder means a spatula, a scale, and a person.
[→] It's inaccurate: dosed by eye, overshoot, then correction.
[→] It varies: two people never dose the same way.
[→] It's tiring: repetitive gestures, fatigue, and fatigue causes errors.
[→] And the record is written by hand, after the act.
[→] For a pharma company, that last one is what hurts.

**3 · ALCOA+ (0:40)**
Pharma records are judged by ALCOA+: nine principles a GMP record must meet.
[→] Manual dosing fails three: it's not contemporaneous, not original, and not complete, because retries vanish. You can prove the result, not how it was reached.

**4 · What it costs (1:00)**
[→] A record QA can't trust blocks the batch.
[→] It opens an investigation.
[→] It shows up in inspections.
[→] At worst, it costs market access.
[→] Data integrity is a licence-to-operate issue.

**5 · Instructions in, proof out (1:20)**
Our answer: recipe in, the auger doses, the load cell measures, the station verifies and writes the record. No timed dispensing.

**6 · The digital recipe (1:35)**
The operator enters a recipe, target, tolerance and a unique sample ID. The format already supports several materials.

**7 · The station (1:45)**
Everything was designed in CAD, 3D-printed and laser-cut, and this model is its live digital twin.

**8 · Live (1:55)**
Let's dose. Checks are green — start. *(press START, then move on while it doses)*

**9 · Real powder fights back (2:05)**
Real powder doesn't flow nicely: it clumps, bridges, sticks, and keeps falling after you stop. Each of these has an answer in the design.

**10 · Auger + stepper (2:15)**
An auger driven by a stepper: one step moves a small, repeatable amount, and powder only moves while the screw turns.

**11 · The scale (2:25)**
A load cell under the cup, on a base isolated from the motor, so vibration never reaches the reading.

**12 · Fast, slow, fine (2:35)**
Speed follows the remaining mass: fast, slow, fine, then settle and trim. We always approach from below, because powder can't be removed.

**13 · Anti-bridging (2:50)**
When powder arches in the hopper, a vibration motor shakes it loose — only in the coarse phases.

**14 · Smart correction (3:00)**
Powder keeps falling after the stop, so we stop early by the overshoot the station learned from its last runs.

**15 · Pre-start checks (3:10)**
Start stays locked until every check is green.

**16 · Guards (3:15)**
*(lift the cup if a dose is running)* Remove the cup and the motor stops, and the run is kept as incomplete. Safety lives on the station, not the network.

**17 · Readable at the bench (3:25)**
The station's own screen shows the current sample. *(Only say "and the result stays there if the link drops" if the real LCD does it.)*

**18 · The verification record (3:35)**
And here is the record of the dose we just ran: target, measured, deviation, accepted — captured at the source, failures included.

**19 · Why MQTT (3:50)**
The dashboard is a web app, so station and screens meet at a secure broker: the phone controls, the projector watches.

**20 · Signed commands (4:00)**
Every command is signed, so only our paired dashboard can drive the motor.

**21 · The brief (4:10)**
The full minimum demo, plus five of the six bonus ideas. Multi-material is the next step.

**22 · One module per material (4:25)**
In a real lab: one module per material, no cross-contamination, one dashboard for all, records flowing to the LIMS.

**23 · Roadmap (4:40)**
Next: calibration with check weights, logs stored on the station, operator e-signature — closing the last ALCOA+ gaps.

**24 · Close (4:50)**
Instructions in, physical action, monitoring, verification, digital record. You just watched all five, live. Thank you.

---

**If time runs short:** skip 9, 17 and 21 (about 30 s).
