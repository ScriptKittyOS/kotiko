# Evaluation results

Newest run on top. Written by `spec/eval/run-eval.mjs`; see `spec/eval/README.md`.

## 2026-10-02 · replay · set all · spec 2.0.0

<!-- summary: {"set":"all","version":"2.0.0","models":{"reference/hand-written":{"cases":133,"pass":{"n":133,"of":133,"pct":100},"core":{"n":29,"of":29,"pct":100},"per_base":{"en":{"n":84,"of":84,"pct":100},"es":{"n":41,"of":41,"pct":100},"fr":{"n":6,"of":6,"pct":100},"ja":{"n":6,"of":6,"pct":100}},"valid_json":{"n":133,"of":133,"pct":100},"intent":{"n":105,"of":105,"pct":100},"language":{"n":104,"of":104,"pct":100},"bases_complete":{"n":3,"of":3,"pct":100},"forms_precision":{"n":6,"of":6,"pct":100},"pronunciation":{"lookup ru en":{"letters":[5,5],"stress":[5,5],"reduction":[4,4],"tones":[0,0],"dropped":[0,5]},"lookup zh en":{"letters":[2,2],"stress":[1,1],"reduction":[0,0],"tones":[2,2],"dropped":[0,2]},"lookup ja en":{"letters":[2,2],"stress":[2,2],"reduction":[0,0],"tones":[0,0],"dropped":[0,2]},"lookup ar en":{"letters":[2,2],"stress":[2,2],"reduction":[0,0],"tones":[0,0],"dropped":[0,2]},"lookup es en":{"letters":[3,3],"stress":[3,3],"reduction":[0,0],"tones":[0,0],"dropped":[0,3]},"lookup ru es":{"letters":[5,5],"stress":[5,5],"reduction":[4,4],"tones":[0,0],"dropped":[0,5]},"lookup zh es":{"letters":[2,2],"stress":[1,1],"reduction":[0,0],"tones":[2,2],"dropped":[0,2]},"lookup ja es":{"letters":[1,1],"stress":[1,1],"reduction":[0,0],"tones":[0,0],"dropped":[0,1]},"lookup ar es":{"letters":[2,2],"stress":[2,2],"reduction":[0,0],"tones":[0,0],"dropped":[0,2]},"lookup en es":{"letters":[3,3],"stress":[3,3],"reduction":[1,1],"tones":[0,0],"dropped":[0,3]},"respell ru en":{"letters":[15,15],"stress":[7,7],"reduction":[4,4],"tones":[0,0],"dropped":[0,15]},"respell ru es":{"letters":[9,9],"stress":[7,7],"reduction":[4,4],"tones":[0,0],"dropped":[0,9]},"respell zh en":{"letters":[4,4],"stress":[0,0],"reduction":[0,0],"tones":[0,0],"dropped":[0,4]},"respell zh es":{"letters":[3,3],"stress":[0,0],"reduction":[0,0],"tones":[0,0],"dropped":[0,3]},"respell ja en":{"letters":[4,4],"stress":[0,0],"reduction":[0,0],"tones":[0,0],"dropped":[0,4]},"respell ja es":{"letters":[1,1],"stress":[0,0],"reduction":[0,0],"tones":[0,0],"dropped":[0,1]},"respell ar en":{"letters":[4,4],"stress":[2,2],"reduction":[0,0],"tones":[0,0],"dropped":[0,4]},"respell ar es":{"letters":[2,2],"stress":[2,2],"reduction":[0,0],"tones":[0,0],"dropped":[0,2]},"respell es en":{"letters":[3,3],"stress":[1,1],"reduction":[0,0],"tones":[0,0],"dropped":[0,3]},"respell en es":{"letters":[4,4],"stress":[3,3],"reduction":[1,1],"tones":[0,0],"dropped":[0,4]}}},"reference/old-prompt-shape":{"cases":29,"pass":{"n":19,"of":29,"pct":65.5},"core":{"n":19,"of":29,"pct":65.5},"per_base":{"en":{"n":12,"of":22,"pct":54.5},"es":{"n":5,"of":7,"pct":71.4},"fr":{"n":1,"of":1,"pct":100},"ja":{"n":1,"of":1,"pct":100}},"valid_json":{"n":29,"of":29,"pct":100},"intent":{"n":29,"of":29,"pct":100},"language":{"n":24,"of":27,"pct":88.9},"bases_complete":{"n":2,"of":2,"pct":100},"forms_precision":{"n":3,"of":3,"pct":100},"pronunciation":{"lookup ru en":{"letters":[0,4],"stress":[0,4],"reduction":[0,4],"tones":[0,0],"dropped":[0,4]},"lookup zh en":{"letters":[0,1],"stress":[0,1],"reduction":[0,0],"tones":[0,1],"dropped":[0,1]},"lookup ja en":{"letters":[0,1],"stress":[0,1],"reduction":[0,0],"tones":[0,0],"dropped":[0,1]},"lookup ar en":{"letters":[0,1],"stress":[0,1],"reduction":[0,0],"tones":[0,0],"dropped":[0,1]},"lookup es en":{"letters":[0,1],"stress":[0,1],"reduction":[0,0],"tones":[0,0],"dropped":[0,1]}}}}} -->

| Model | Pass | Core | Base en | Base es | Base fr | Base ja | Valid JSON | Intent | Language | Bases complete | Forms precision | Latency median / p95 | Requests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference/hand-written | 100% (133/133) | 100% (29/29) | 100% (84/84) | 100% (41/41) | 100% (6/6) | 100% (6/6) | 100% (133/133) | 100% (105/105) | 100% (104/104) | 100% (3/3) | 100% (6/6) | – | 0 |
| reference/old-prompt-shape | 65.5% (19/29) | 65.5% (19/29) | 54.5% (12/22) | 71.4% (5/7) | 100% (1/1) | 100% (1/1) | 100% (29/29) | 100% (29/29) | 88.9% (24/27) | 100% (2/2) | 100% (3/3) | – | 0 |

Pronunciation, reference/hand-written:

| Prompt | Target | Base | Letters | Stress | Vowel reduction | Tones | Dropped by the checks |
|---|---|---|---|---|---|---|---|
| lookup | ar | en | 100% (2/2) | 100% (2/2) | – | – | 0% (0/2) |
| lookup | ar | es | 100% (2/2) | 100% (2/2) | – | – | 0% (0/2) |
| lookup | en | es | 100% (3/3) | 100% (3/3) | 100% (1/1) | – | 0% (0/3) |
| lookup | es | en | 100% (3/3) | 100% (3/3) | – | – | 0% (0/3) |
| lookup | ja | en | 100% (2/2) | 100% (2/2) | – | – | 0% (0/2) |
| lookup | ja | es | 100% (1/1) | 100% (1/1) | – | – | 0% (0/1) |
| lookup | ru | en | 100% (5/5) | 100% (5/5) | 100% (4/4) | – | 0% (0/5) |
| lookup | ru | es | 100% (5/5) | 100% (5/5) | 100% (4/4) | – | 0% (0/5) |
| lookup | zh | en | 100% (2/2) | 100% (1/1) | – | 100% (2/2) | 0% (0/2) |
| lookup | zh | es | 100% (2/2) | 100% (1/1) | – | 100% (2/2) | 0% (0/2) |
| respell | ar | en | 100% (4/4) | 100% (2/2) | – | – | 0% (0/4) |
| respell | ar | es | 100% (2/2) | 100% (2/2) | – | – | 0% (0/2) |
| respell | en | es | 100% (4/4) | 100% (3/3) | 100% (1/1) | – | 0% (0/4) |
| respell | es | en | 100% (3/3) | 100% (1/1) | – | – | 0% (0/3) |
| respell | ja | en | 100% (4/4) | – | – | – | 0% (0/4) |
| respell | ja | es | 100% (1/1) | – | – | – | 0% (0/1) |
| respell | ru | en | 100% (15/15) | 100% (7/7) | 100% (4/4) | – | 0% (0/15) |
| respell | ru | es | 100% (9/9) | 100% (7/7) | 100% (4/4) | – | 0% (0/9) |
| respell | zh | en | 100% (4/4) | – | – | – | 0% (0/4) |
| respell | zh | es | 100% (3/3) | – | – | – | 0% (0/3) |

Pronunciation, reference/old-prompt-shape:

| Prompt | Target | Base | Letters | Stress | Vowel reduction | Tones | Dropped by the checks |
|---|---|---|---|---|---|---|---|
| lookup | ar | en | 0% (0/1) | 0% (0/1) | – | – | 0% (0/1) |
| lookup | es | en | 0% (0/1) | 0% (0/1) | – | – | 0% (0/1) |
| lookup | ja | en | 0% (0/1) | 0% (0/1) | – | – | 0% (0/1) |
| lookup | ru | en | 0% (0/4) | 0% (0/4) | 0% (0/4) | – | 0% (0/4) |
| lookup | zh | en | 0% (0/1) | 0% (0/1) | – | 0% (0/1) | 0% (0/1) |

