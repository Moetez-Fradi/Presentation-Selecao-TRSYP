import type { ReactNode } from 'react'
import type { TwinState } from '../twin/TwinScene'
import type { TwinShot } from './Stage3D'
import type { DashShot } from './DashZoom'
import type { TwinMode } from './twinScript'
import Arch from './Arch'

export interface Slide {
  id: string
  kicker?: string
  layout: 'left' | 'center' | 'top' | 'wide'
  layer: 'twin' | 'dash' | 'arch'
  twin: TwinShot
  mode: TwinMode
  dim?: boolean // twin pushed back behind text-heavy slides
  dash?: DashShot
  steps?: number // extra clicks that reveal content inside the slide
  twinOff?: boolean // machine fully hidden
  body: (ctx: { twin: TwinState; step: number }) => ReactNode
  notes: string
}

// ---- camera shots (world mm, see TwinScene for the frame) ------------------
const HERO: TwinShot = { cam: [[720, 470, 460], [40, 175, -95]], rotate: true }
const BACK: TwinShot = { cam: [[1050, 620, 700], [60, 190, -95]], rotate: true }
const SIDE_WALL_OFF = ['wallMotor']
const CUP_VIEW: TwinShot = { cam: [[330, 190, 40], [0, 100, -150]], hide: SIDE_WALL_OFF }

const EXPLODED: TwinShot = {
  cam: [[1250, 780, 920], [60, 240, -95]],
  pose: {
    hopper: [0, 270, 0], top: [0, 175, 0], tube: [0, 95, 0], auger: [0, 160, 0],
    motor: [0, 0, 220], wallMotor: [0, 0, 120], wallRight: [0, 0, -130],
    electronics: [150, 0, 0], cup: [150, 45, 0], plate: [95, 18, 0], loadcell: [45, 0, 0],
  },
  hide: ['stream'],
  callouts: [
    { text: 'Transparent hopper', at: [0, 385, -50], rig: 'hopper' },
    { text: 'Laser-cut MDF frame', at: [90, 255, -100], rig: 'top' },
    { text: 'Auger screw (3D-printed)', at: [0, 172, -110], rig: 'auger', tone: 'accent' },
    { text: 'NEMA 17 stepper', at: [0, 182, 25], rig: 'motor' },
    { text: 'Bar load cell + HX711', at: [0, 42, -115], rig: 'loadcell', tone: 'accent' },
    { text: 'Cup plate', at: [0, 62, -150], rig: 'plate' },
    { text: 'ESP32 · drivers · LCD', at: [205, 105, -150], rig: 'electronics' },
  ],
}

const AUGER: TwinShot = {
  cam: [[330, 300, 380], [-70, 150, -40]],
  pose: { motor: [0, 0, 60] },
  hide: SIDE_WALL_OFF,
  callouts: [
    { text: 'NEMA 17 stepper', at: [0, 186, 30], rig: 'motor', tone: 'accent' },
    { text: 'Auger: one step = a small, repeatable amount', at: [0, 178, -125], rig: 'auger' },
    { text: 'Powder moves only while the screw turns', at: [0, 112, -60], rig: 'tube' },
  ],
}

const LOADCELL: TwinShot = {
  cam: [[560, 340, 330], [0, 125, -140]],
  pose: { motor: [0, 0, 260], cup: [0, 150, 0], plate: [0, 75, 0], hopper: [0, 420, 0], top: [0, 320, 0], tube: [0, 260, 0], auger: [0, 260, 0] },
  hide: ['wallMotor', 'motor', 'hopper', 'top', 'tube', 'auger', 'stream'],
  callouts: [
    { text: 'Bar load cell + HX711', at: [0, 40, -95], rig: 'loadcell', tone: 'accent' },
    { text: 'Plate lip: same cup position every time', at: [0, 62, -150], rig: 'plate' },
    { text: 'Cup', at: [0, 112, -150], rig: 'cup' },
    { text: 'Separate base: motor vibration never reaches it', at: [60, 18, -60] },
  ],
}

const HOPPER: TwinShot = {
  cam: [[430, 440, 270], [0, 290, -60]],
  hide: SIDE_WALL_OFF,
  callouts: [{ text: 'Vibration motor on the hopper wall', at: [75, 275, -45], rig: 'hopper', tone: 'accent' }],
}

const LAB: TwinShot = { ...BACK, pose: { electronics: [130, 0, 0] } }

// the screen sits at about (167, 60, −60), facing +X and up
const LCD: TwinShot = {
  cam: [[330, 230, 30], [160, 70, -62]],
  callouts: [{ text: 'Station screen: current sample at a glance', at: [175, 105, -60], tone: 'accent' }],
}

const FLEET: TwinShot = {
  cam: [[1750, 1050, 820], [40, 190, -95]],
  rotate: true,
  callouts: [{ text: 'Material A · 10.0 g', at: [0, 400, -95], tone: 'accent' }],
  fleet: [
    { at: [0, 0, -360], label: 'Material B · 5.0 g' },
    { at: [0, 0, 360], label: 'Material C · 2.0 g' },
  ],
}

const DASH_REGION = { x: 0.37, y: 0.07, w: 0.6, h: 0.86 }
export const regionFor = (s: Slide) => (s.layout === 'top' ? { x: 0.02, y: 0.17, w: 0.96, h: 0.8 } : DASH_REGION)

// ---- slides ------------------------------------------------------------------
export const SLIDES: Slide[] = [
  {
    id: 'title', layout: 'left', layer: 'twin', twin: HERO, mode: 'idle',
    body: () => (
      <>
        <p className="kick">TRSYP 3.0 · Laboratory 4.0 · Axis 2</p>
        <h1 className="display">Automated Weighing Station</h1>
        <p className="team">Seleção, IEEE INSAT</p>
      </>
    ),
    notes: 'Hook: every powder dose in a lab today depends on a hand, a spatula, and nobody writing it down. Introduce the team in one line.',
  },
  {
    id: 'problem', kicker: 'The problem', layout: 'wide', layer: 'twin', twin: BACK, mode: 'idle', twinOff: true, steps: 5,
    body: ({ step }) => (
      <>
        <h2 className="title">Manual dosing today</h2>
        <br></br>
        <div className="probs">
          {[
            ['01', 'Inaccuracy', 'Dosed by eye'],
            ['02', 'Variability', 'Depends on who doses'],
            ['03', 'Human cost', 'Strain and fatigue'],
            ['04', 'No audit trail', 'Written after the act'],
          ].map(([n, t, d], k) => (
            <div key={n} className={`prob step ${step > k ? '' : 'wait'} ${step > 4 && k < 3 ? 'dimmed' : ''}`}>
              <span className="num">{n}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
        <p className={`punch step ${step > 4 ? '' : 'wait'}`}>For a pharma company, 04 is the one that hurts.</p>
      </>
    ),
    notes: 'One click per problem, one sentence each. 01: powder added and removed by eye, overshoot then correction. 02: two operators never dose the same way. 03: repetitive gestures cause musculoskeletal disorders, fatigue erodes attention and causes errors. 04: the record is written by hand after the act; failed attempts vanish. Last click: 04 is the one that hurts a pharma company.',
  },
  {
    id: 'alcoa', kicker: 'Data integrity', layout: 'wide', layer: 'twin', twin: BACK, mode: 'idle', twinOff: true, steps: 1,
    body: ({ step }) => {
      const fail: Record<string, string> = { C: 'written after the gesture', O: 'copied from the balance display', 'C+': 'retries and removed powder vanish' }
      const letters: [string, string][] = [
        ['A', 'Attributable'], ['L', 'Legible'], ['C', 'Contemporaneous'], ['O', 'Original'], ['A', 'Accurate'],
        ['C+', 'Complete'], ['C+', 'Consistent'], ['E+', 'Enduring'], ['A+', 'Available'],
      ]
      return (
        <>
          <h2 className="title">ALCOA+: the test every GMP record must pass</h2>
          <p className="sub">What regulators (FDA, EMA, WHO, PIC/S) expect from any record a batch depends on.</p>
          <div className="alcoa">
            {letters.map(([l, w], k) => {
              const why = step > 0 && (w === 'Contemporaneous' || w === 'Original' || w === 'Complete') ? fail[l] : ''
              return (
                <div key={w} className={`al rise ${why ? 'fail' : step > 0 ? 'dimmed' : ''}`} style={{ animationDelay: `${0.1 + k * 0.06}s` }}>
                  <span className="al-l">{l.replace('+', '')}</span>
                  <span className="al-w">{w}</span>
                  <span className="al-why">{why || ' '}</span>
                </div>
              )
            })}
          </div>
          <p className={`punch step ${step > 0 ? '' : 'wait'}`}>Manual dosing proves the result. Not how it was reached.</p>
        </>
      )
    },
    notes: 'ALCOA+ = Attributable, Legible, Contemporaneous, Original, Accurate, + Complete, Consistent, Enduring, Available. Click: the three that manual dosing fails. Balance printouts exist, so never say "no logs": the problem is the process, not the final number.',
  },
  {
    id: 'cost', kicker: 'Why it matters', layout: 'wide', layer: 'twin', twin: BACK, mode: 'idle', twinOff: true, steps: 5,
    body: ({ step }) => (
      <>
        <h2 className="title">What a weak record costs a company</h2>
        <div className="costs">
          {[
            ['Batch on hold', "A record QA can't trust means a batch that can't be released."],
            ['Investigations', 'Deviation, root cause, CAPA: days of QA time per event.'],
            ['Inspection findings', 'FDA 483 observations, warning letters, EU non-compliance.'],
            ['Market access', 'Import alerts, suspended licences, recalls.'],
          ].map(([t, d], k) => (
            <div key={t} className={`cost step ${step > k ? '' : 'wait'}`}>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
        <p className={`punch step ${step > 4 ? '' : 'wait'}`}>Data integrity is a licence-to-operate issue, not paperwork.</p>
      </>
    ),
    notes: 'Data integrity is a recurring theme of FDA warning letters and EU GMP non-compliance reports. Do not quote numbers we cannot source. Bridge: so we built a station whose record is captured at the source, by design.',
  },

  {
    id: 'loop', kicker: 'Our answer', layout: 'left', layer: 'twin', twin: { cam: [[700, 430, 420], [40, 170, -95]] }, mode: 'dosing',
    body: () => (
      <>
        <h2 className="title">Instructions in.<br />Proof out.</h2>
        <ol className="loop">
          {['Recipe in', 'Auger doses', 'Load cell measures', 'Verify', 'Digital record'].map((s, i) => (
            <li key={s} className="rise" style={{ animationDelay: `${0.15 + i * 0.12}s` }}>{s}</li>
          ))}
        </ol>
        <p className="rule">No timed dispensing. Every action is decided by the measured weight.</p>
      </>
    ),
    notes: 'The full loop the challenge asks for. Goals: precision 0.1 g, reproducibility, traceability.',
  },
  {
    id: 'recipe', kicker: 'Recipe in', layout: 'left', layer: 'dash', twin: BACK, mode: 'idle', dash: { tab: 'Run', focus: 'Recipe' },
    body: () => (
      <>
        <h2 className="title">The digital recipe</h2>
        <p className="sub">Recipe ID, one line per material, target and tolerance, and a unique sample ID.</p>
        <p className="muted">The format already carries multi-material recipes: A 10.0 g · B 5.0 g · C 2.0 g.</p>
      </>
    ),
    notes: 'The brief: recipe → measure → dose → verify → record. This is the first step: the operator enters the recipe, the station turns it into dosing actions.',
  },
  {
    id: 'cad', kicker: 'The station', layout: 'left', layer: 'twin', twin: EXPLODED, mode: 'idle',
    body: () => (
      <>
        <h2 className="title">Designed in CAD.<br />Built in 18 hours.</h2>
        <p className="sub">3D-printed and laser-cut parts. This model is the live digital twin, driven by the station itself.</p>
      </>
    ),
    notes: 'CAD criterion. STL parts printed, DXF panels laser-cut. Weighing base mechanically separate from the dosing tower. You can drag the model to rotate it.',
  },
  {
    id: 'demo', kicker: 'Live', layout: 'top', layer: 'dash', twin: HERO, mode: 'idle', dash: { tab: 'Run', interactive: true },
    body: () => (
      <>
        <h2 className="title small">Let's dose. Live.</h2>
        <p className="sub">Recipe · sample ID · checks turn green · START</p>
      </>
    ),
    notes: 'START THE REAL DOSE NOW from this screen or the phone. Then keep going: the next slides explain what the machine is doing while it doses.',
  },
  {
    id: 'powder', layout: 'wide', layer: 'twin', twin: HOPPER, mode: 'dosing', dim: true,
    body: () => (
      <>
        <h2 className="title">Real powder fights back</h2>
        <div className="fight">
          {[
            ['Inconsistent flow', 'Closed loop on the weight. Never timed.'],
            ['Clumping', 'The auger shears and pushes it through.'],
            ['Bridging in the hopper', 'Vibration bursts in the coarse phases.'],
            ['Clogging · no flow', 'Auger turning, weight flat for 4 s: stop and flag.'],
            ['Sticking to surfaces', 'Steep smooth surfaces, tare before every dose.'],
            ['Overshoot after the stop', 'Stop at (target − learned overshoot), trim from below.'],
          ].map(([k, v], i) => (
            <div key={k} className="fight-row rise" style={{ animationDelay: `${0.1 + i * 0.09}s` }}>
              <b>{k}</b>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </>
    ),
    notes: 'These six are exactly the material behaviours the spec book lists. The next slides show how each is handled.',
  },
  {
    id: 'auger', layout: 'left', layer: 'twin', twin: AUGER, mode: 'dosing',
    body: () => (
      <>
        <h2 className="title">Auger + stepper</h2>
        <p className="sub">One step moves a small, repeatable amount. Powder only moves while the screw turns, so it stops cleanly.</p>
        <p className="muted">Chosen over gravity or a valve: finer resolution, handles light clumping.</p>
      </>
    ),
    notes: 'Auger: one microstep = a small repeatable mass. The tube is drawn see-through so you can watch the screw.',
  },
  {
    id: 'loadcell', layout: 'left', layer: 'twin', twin: LOADCELL, mode: 'idle',
    body: () => (
      <>
        <h2 className="title">The scale is the only truth</h2>
        <p className="sub">Bar load cell + HX711 under the cup. The weighing base is isolated from the motor tower, so vibration never reaches the reading.</p>
        <p className="muted">Adaptive filter: smooth when steady, fast when the weight changes, drift tracking, stability detector.</p>
      </>
    ),
    notes: 'Mechanical isolation + filtering. Tare is repeated before each dose.',
  },
  {
    id: 'phases', layout: 'left', layer: 'twin', twin: CUP_VIEW, mode: 'dosing',
    body: ({ twin }) => {
      const order = ['FAST', 'SLOW', 'FINE', 'SETTLE', 'TRIM'] as const
      const cur = twin.state === 'DONE' ? 'DONE' : twin.phase
      return (
        <>
          <h2 className="title">Fast → slow → fine</h2>
          <p className="sub">Speed follows the remaining mass. Powder can't be removed, so we always approach from below.</p>
          <div className="readout">
            <span className="w">{twin.weight.toFixed(2)}</span><span className="u">g / 10.00</span>
          </div>
          <div className="ladder">
            {order.map((p) => <span key={p} className={cur === p ? 'on' : ''}>{p}</span>)}
            <span className={`ok ${cur === 'DONE' ? 'on' : ''}`}>ACCEPTED</span>
          </div>
          <p className="muted">75% → 95% → stop at target − overshoot → settle → trim (≤ 6)</p>
        </>
      )
    },
    notes: 'Narrate the phases as the model doses. Settle waits until the scale is stable; trim adds 1-3 microsteps at a time.',
  },
  {
    id: 'bridging', layout: 'left', layer: 'twin', twin: HOPPER, mode: 'vib',
    body: () => (
      <>
        <h2 className="title">Anti-bridging</h2>
        <p className="sub">Powder can arch over the outlet and stop flowing. A vibration motor shakes it loose during the coarse phases, and stays off in the fine phase so it never disturbs the reading.</p>
      </>
    ),
    notes: 'If the live chart shows a flat step, that is a bridge being cleared.',
  },
  {
    id: 'smart', layout: 'left', layer: 'dash', twin: BACK, mode: 'idle', dash: { tab: 'Stats', focus: 'Overshoot learning' },
    body: () => (
      <>
        <h2 className="title">Smart correction</h2>
        <p className="sub">Powder keeps falling after the motor stops. We stop at <b>target − learned overshoot</b>.</p>
        <ul className="ticks">
          <li>Average of the last 5 runs</li>
          <li>Disturbed runs ignored</li>
          <li>Clamped on the station</li>
        </ul>
      </>
    ),
    notes: 'Real data from our runs. The next start always uses what the previous runs measured.',
  },
  {
    id: 'checks', layout: 'left', layer: 'dash', twin: BACK, mode: 'idle', dash: { tab: 'Run', focus: 'Pre-start checks' },
    body: () => (
      <>
        <h2 className="title">Pre-start checks</h2>
        <p className="sub">START stays locked until cup, tare, hopper, recipe and sample ID are all green. Duplicate sample IDs are refused.</p>
      </>
    ),
    notes: 'These are the live checks of the station in front of you.',
  },
  {
    id: 'guards', layout: 'left', layer: 'twin', twin: CUP_VIEW, mode: 'nocup',
    body: () => (
      <>
        <h2 className="title">Guards</h2>
        <p className="sub">Cup removed, no flow, timeout, link lost: the motor stops and the run is kept as incomplete.</p>
        <p className="rule">Safety lives on the ESP32. It never depends on the network.</p>
      </>
    ),
    notes: 'LIVE: lift the cup during a dose. Also: no-flow after 4 s, dose timeout, 5 s link watchdog.',
  },
  {
    id: 'lcd', layout: 'left', layer: 'twin', twin: LCD, mode: 'dosing',
    body: () => (
      <>
        <h2 className="title">Readable at the bench</h2>
        <p className="sub">The station's own screen shows the current sample: phase, weight, then the result.</p>
        <p className="rule">If the link drops, the result stays on the station.</p>
      </>
    ),
    notes: 'CHECK FIRST: the real LCD must show phase / weight / result. If the firmware does not do it yet, say "the screen is wired and ready" instead.',
  },
  {
    id: 'record', layout: 'left', layer: 'dash', twin: BACK, mode: 'idle', dash: { tab: 'Run', focus: 'Verification record' },
    body: () => (
      <>
        <h2 className="title">The verification record</h2>
        <p className="sub">Target, measured, deviation, Accepted / Rejected, sample, trims, overshoot, timestamps.</p>
        <p className="rule">Captured at the source, at the moment it happens. Failures included.</p>
      </>
    ),
    notes: 'This is the result of the dose we started live. Show History + CSV export if time allows.',
  },
  {
    id: 'mqtt', layout: 'left', layer: 'arch', twin: BACK, mode: 'idle', dim: true,
    body: () => (
      <>
        <h2 className="title">Why MQTT</h2>
        <p className="sub">The dashboard is a web app: a browser can't open a plain connection to a device on the local network. Both meet at a TLS broker.</p>
        <p className="muted">Phone controls, projector watches. No install, works from a phone hotspot. USB serial stays as fallback.</p>
      </>
    ),
    notes: 'Retained status: a new page sees the state instantly. LWT: offline detected automatically. QoS 1: every result delivered.',
  },
  {
    id: 'signed', layout: 'left', layer: 'arch', twin: BACK, mode: 'idle', dim: true,
    body: () => (
      <>
        <h2 className="title">Signed commands</h2>
        <p className="sub">The broker is public, so every command carries an HMAC-SHA256 signature from the paired dashboard.</p>
        <p className="muted">Unsigned, forged and replayed commands are rejected by the ESP32 (tested).</p>
      </>
    ),
    notes: 'In production: a self-hosted broker, same signing scheme.',
  },
  {
    id: 'brief', kicker: 'The brief', layout: 'wide', layer: 'twin', twin: BACK, mode: 'idle', dim: true,
    body: () => (
      <>
        <h2 className="title">Minimum demo, then the bonus</h2>
        <div className="brief">
          <div className="rise">
            <span className="lane-h">Minimum demo</span>
            {['Target entered by the user', 'Fast → slow → fine, driven by the weight', 'Target, measured, deviation, Accepted / Rejected', 'Every dose logged'].map((t) => <p key={t} className="ck">{t}</p>)}
          </div>
          <div className="rise" style={{ animationDelay: '.2s' }}>
            <span className="lane-h">Bonus ideas</span>
            {['Overshoot compensation that learns', 'Anti-bridging vibration', 'Automatic tare + cup detection', 'Dashboard with run history', 'Repeatability statistics over 10 runs'].map((t) => <p key={t} className="ck">{t}</p>)}
            <p className="ck part">Multi-material recipe: format ready, second hopper next</p>
          </div>
        </div>
      </>
    ),
    notes: 'Straight from the spec book. Be honest on multi-material: the recipe format and dashboard support several lines, the second hopper is on the roadmap.',
  },
  {
    id: 'vision', kicker: 'Laboratory 4.0', layout: 'left', layer: 'twin', twin: FLEET, mode: 'dosing',
    body: () => (
      <>
        <h2 className="title">One module per material</h2>
        <p className="sub">Identical stations, one per material: no cross-contamination. One dashboard supervises them all.</p>
        <p className="muted">Every record flows to the lab's LIMS / ELN, signed by the operator.</p>
      </>
    ),
    notes: 'This is the reuse-in-a-real-lab criterion: modular firmware and a protocol that already carries several material lines.',
  },
  {
    id: 'roadmap', kicker: 'Roadmap', layout: 'wide', layer: 'twin', twin: LAB, mode: 'idle', dim: true,
    body: () => (
      <>
        <h2 className="title">From prototype to lab instrument</h2>
        <div className="road">
          {[
            ['Today', ['Closed loop to ±0.1 g', 'Verification + learning', 'Signed remote control', 'History, CSV, 3D twin']],
            ['Next', ['Check-weight calibration', 'Log stored on the station', 'One hopper per material', 'Self-hosted broker']],
            ['Lab integration', ['Operator login + e-signature', 'LIMS / ELN export', 'Barcode IDs', 'Fleet dashboard']],
          ].map(([h, items], i) => (
            <div key={h as string} className={`lane rise ${i === 0 ? 'now' : ''}`} style={{ animationDelay: `${0.15 + i * 0.15}s` }}>
              <span className="lane-h">{h as string}</span>
              {(items as string[]).map((t) => <span key={t}>{t}</span>)}
            </div>
          ))}
        </div>
        <p className="foot">Closes the last ALCOA+ gaps: attributable and enduring records (21 CFR Part 11 / EU GMP Annex 11).</p>
      </>
    ),
    notes: 'Today covers 7 of 9 ALCOA+ properties. Do not claim GMP compliance: that needs validation (IQ/OQ/PQ).',
  },
  {
    id: 'close', layout: 'left', layer: 'twin', twin: HERO, mode: 'done',
    body: () => (
      <>
        <h2 className="display small">Instructions in.<br />Physical action.<br />Monitoring.<br />Verification.<br />Digital record.</h2>
        <p className="lede">You just watched all five, live. Thank you.</p>
      </>
    ),
    notes: 'Close and open the floor.',
  },
]

export { Arch }
