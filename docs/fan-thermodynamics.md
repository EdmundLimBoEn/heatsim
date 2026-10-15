# Fans, pressure and adiabatic expansion

**For HeatSim:** show expansion as an educational calculation, separate from the simulated room temperatures. A fan supplies energy to the air. Ventilation can carry heat out when replacement air is cooler, and air movement can improve personal comfort; neither effect requires a fan to manufacture cold air. [DOE explanation](https://www.energy.gov/indianenergy/articles/energy-saving-hacks-beat-summer-heat).

## Ideal expansion comparison

Adiabatic means no heat transfer. The familiar pressure–temperature relation additionally assumes reversible flow, so it is **isentropic**, with an ideal gas and constant specific heats:

\[
T_2=T_1\left(\frac{p_2}{p_1}\right)^{(\gamma-1)/\gamma}.
\]

Use **absolute pressure** in this ratio, and kelvin for temperature. This relation describes specified thermodynamic states; a fan's pressure-rise rating is not automatically the pressure drop across an ideal expansion nozzle. [NASA isentropic relations](https://www.grc.nasa.gov/www/k-12/airplane/isentrop.html).

Calculated example: dry air, \(T_1=303\,K\), \(p_1=101325\,Pa\), \(\gamma=1.4\), and \(p_2=p_1-\Delta p\). These pressures are hypothetical inputs, not measured model-fan specifications.

| Pressure drop | Final absolute pressure | Ideal static-temperature drop |
|---|---|---|
| 10 Pa | 101315 Pa | 0.008544 K = 0.008544°C |
| 30 Pa | 101295 Pa | 0.025635 K = 0.025635°C |
| 100 Pa | 101225 Pa | 0.085469 K = 0.085469°C |

For small pressure differences, the first-order expression is
\(T_1-T_2\approx T_1(\gamma-1)\Delta p/(\gamma p_1)\).
These are conditional ideal-expansion results, **not a bound on whole-room cooling**.

## Static temperature is not total energy

For steady flow with negligible height changes, the energy balance is
\(\Delta(h+v^2/2)=q+w_{in}\). With constant \(c_p\), stagnation temperature satisfies
\(T_0=T+v^2/(2c_p)\). An adiabatic nozzle with no shaft work trades static enthalpy for velocity while keeping total enthalpy constant. Mixing and dissipation can return that kinetic energy to heat. This is an inference from [NASA's flow-energy equations](https://www.grc.nasa.gov/WWW/K-12/airplane/thermo1f508.html).

For \(c_p=1005\,J/(kg\,K)\), the static-to-stagnation difference is only 0.000498 K at 1 m/s, 0.001990 K at 2 m/s, or 0.012438 K at 5 m/s. A real opening with losses is not automatically an isentropic nozzle. Adiabatic throttling between low-speed states conserves enthalpy; for the ideal-gas approximation it does not supply a persistent temperature reduction.

Across a fan, work enters the flow and increases total enthalpy. Ideal compression followed by an ideal return to the starting pressure cannot create a net colder reservoir without another energy-removal mechanism. [NASA compressor work and total-temperature relation](https://www.grc.nasa.gov/www/k-12/airplane/compth.html).

## Fan power and heating

For volume flow \(\dot V\), total pressure rise \(\Delta p_t\), and compatible efficiencies:

\[
P_{air}=\dot V\Delta p_t,\qquad
P_{shaft}=P_{air}/\eta_{fan},\qquad
P_{electric}=P_{air}/\eta_{overall}.
\]

Units are m³/s, Pa and W. Do not mix static-pressure efficiency with total-pressure rise. [DOE fan-system sourcebook, Fan Performance Curves](https://www.energy.gov/sites/default/files/2014/05/f16/fan_sourcebook.pdf).

EnergyPlus accounts for fan and motor energy entering the air using
\(P_{toair}=\eta_mP_{electric}+(1-\eta_m)P_{electric}f_{motor\to air}\), then
\(\Delta T_{fan}=P_{toair}/(\dot m c_p)\), where \(\dot m=\rho\dot V\). If all motor losses enter the airstream, \(P_{toair}=P_{electric}\). This is positive fan-heat accounting, not a prediction of the immediate static temperature at a blade tip. [EnergyPlus design fan heat](https://energyplus.readthedocs.io/en/stable/guides/engineering-reference/10.7-component-sizing.html#design-fan-heat).

Using the given constants consistently gives \(R=c_p(\gamma-1)/\gamma=287.143\,J/(kg\,K)\) and \(\rho=p/(RT)=1.16460\,kg/m^3\). Ideal pressure work \(\Delta p/\rho\) is 8.587, 25.760 and 85.867 J/kg for 10, 30 and 100 Pa. Its equivalent temperature rise is about 0.008544, 0.025632 and 0.085439 K respectively; inefficiency increases the required input.

For a hypothetical 30 Pa fan moving 0.05 m³/s at 50% overall efficiency: air power is 1.5 W and electrical power is 3 W. If all of that power enters the airstream, the corresponding fan-heat rise is approximately **+0.0513 K**.

## Calculator implementation

`src/fan-thermodynamics.ts` exports `calculateFanThermodynamics`, its input/result types, and `FAN_THERMODYNAMICS_DEFAULTS`. The UI defaults are 303 K, 101325 Pa, γ = 1.4, **rounded density 1.17 kg/m³**, and cp = 1005 J/(kg K). With that rounded density the same 3 W example gives **+0.0510 K**. The pressure-expansion result does not depend on density.

Supply `pressureDifferencePa`; optionally supply `flowM3s` and `efficiency` (overall electrical-to-air-pressure efficiency). The same hypothetical pressure magnitude is compared in two separate processes: a reversible pressure decrease and a fan pressure increase. These are not consecutive stages of a cooling cycle. Fan heat assumes all electrical input eventually enters the air. Zero flow returns `null` for fan temperature rise; the pressure–flow power formula does not model stalled-motor electricity use. Invalid, non-finite and overflowing inputs throw `RangeError`. The helper reads no solver state or simulation pressure.

Run the calculation regressions with `bun run test tests/fan-thermodynamics.test.ts`.

## Suggested educational display

**Title:** “Pressure and temperature: ideal comparison”

**Result label:** “Ideal static-temperature drop: 0.026°C” (30 Pa example)

**Caption:** “Assumes reversible expansion of dry air. This is not predicted room cooling. Fan heat and mixing are excluded.”

Keep this number outside the room-temperature solver and comfort score. In the simulation, fans add airflow; ventilation transports the actual outdoor temperature, and any fan thermal term must represent positive energy input. Use measured fan curves and a consistent energy balance before claiming physical outlet temperatures.

Written by gpt-6-astra in Codex on behalf of Edmund
