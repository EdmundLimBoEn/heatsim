# Cooling science for the HeatSim presentation

Research checked 15 October 2026. This note supports the teacher-requested convection extension and paired comparisons. [The simulation specification](02-simulation.md) and [checklist](../CHECKLIST.md) describe what is actually implemented and tested. A two-layer extension is a simplified teaching model; citing established physics does not validate HeatSim's numerical predictions.

## Three ways heat moves

| Mechanism | What happens in a flat | Useful demonstration |
|---|---|---|
| **Conduction** | Heat passes through materials from warmer regions toward cooler ones. A warm outside wall can pass heat inward. | Compare the same wall area and temperature difference with greater versus smaller thermal resistance. Insulation slows transfer; it does not produce cold. |
| **Convection** | Moving air transports heat. Air warmed by a person or surface can become buoyant relative to its surroundings and rise; fans can drive additional movement. | Compare upper and occupied-zone temperatures, circulation and outdoor exhaust. Moving heat upstairs is different from removing it from the flat. |
| **Radiation** | Surfaces exchange electromagnetic energy; sunlight adds energy to exposed surfaces and through glazing. Air need not move for this transfer. | Compare exposed versus shaded west-facing surfaces. Preventing solar gain reduces the subsequent cooling load. |

These mechanisms follow [DOE's heat-flow explanation](https://bsesc.energy.gov/energy-basics/heat-flow). In an actual building they interact: sunlight warms a surface, conduction carries heat through it, and convection transfers some heat between the surface and room air.

**Radiative cooling is a separate effect from shading.** An exposed surface can lose heat toward a clear night sky; cloud cover limits that opportunity. Do not represent shading as a refrigerator or assume a constant night-sky cooling power. The Australian government's [passive-cooling guide](https://www.yourhome.gov.au/passive-design/passive-cooling) describes both solar protection and night-sky radiation. HeatSim does not calculate surface emissivity, sky temperature or radiant comfort.

## Ordinary fans and high-level exhaust do different jobs

A **ceiling or desk fan recirculates air**. Air movement can improve a person's heat loss and sweat evaporation without reducing the room's dry-bulb temperature. It must not be implemented as a negative heat source. [DOE's fan guidance](https://content.govdelivery.com/accounts/USEERE/bulletins/39a1721?reqfrom=share) distinguishes personal comfort from room cooling and calls for ventilation fans to discharge outdoors.

A **high-level exhaust fan removes air outdoors**. It needs a connected make-up-air route, such as an open exterior window and open internal doors. If the extracted upper air is warmer than the incoming air, that exchange can remove sensible heat. If replacement air is hotter, the exchange can add heat; it can also bring in humidity and pollution. PNNL's [whole-house-fan guide](https://basc.pnnl.gov/resource-guides/whole-house-fans) explains the need for intake openings, cooler outdoor air and climate-dependent operation. Its US attic installation details are not an HDB design specification.

For an ideal steady, balanced inlet/exhaust pair, our heat-balance illustration is:

```text
sensible heat exported = ρ × cp × Q × (T_exhaust − T_inlet)
```

Here `Q` is air volume flow in m³/s, `ρ` air density in kg/m³ and `cp` specific heat in J/(kg·K), giving watts. The sign matters. This excludes latent moisture loads, wall storage and fan heat. In a sealed-room test, an exhaust control cannot continually remove air without supplying replacement air. A blocked make-up path must reduce flow or be represented by an explicitly disclosed leakage assumption.

Buoyant plumes and stratification motivate a lower/upper-layer display. [EnergyPlus's Room Air Models reference](https://bigladdersoftware.com/epx/docs/25-1/engineering-reference/room-air-models.html) describes displacement ventilation and idealized plume-based layers, with specific supply conditions and limitations. Those models do not establish that a fan near any ceiling automatically creates effective displacement ventilation, or that our fixed layer heights and exchange coefficients are correct.

## Applying the ideas to Singapore

| Strategy | Benefit and trade-off to explain |
|---|---|
| **Shade first** | Reduce solar gains before trying to remove them. BCA's NUS SDE4 example combines an overhanging roof, a ventilated layout and ceiling fans with pre-cooled fresh air. It demonstrates complementary measures, not a predicted HDB saving. [BCA case study](https://www1.bca.gov.sg/resources/past-articles/platinum-practices-how-nus-made-its-green-mark/) |
| **Keep an airflow route open when outdoor conditions suit** | Cross-ventilation needs connected openings; weather and obstructions affect it. NEA describes cross-ventilation as more effective than single-sided ventilation and qualifies opening windows by outdoor air quality and weather. [NEA ventilation guidance, §4](https://www.nea.gov.sg/our-services/public-cleanliness/environmental-cleaning-guidelines/advisories/guidance-on-improving-ventilation-and-indoor-air-quality-in-buildings-amid-the-covid-19-situation) |
| **Treat evening cooling as conditional** | MSS describes typical nighttime minima around 23–25 °C, high humidity before sunrise and generally weaker nighttime winds. Cooler air may remove sensible heat, but that does not guarantee dehumidification or a strong breeze. This last point is our inference from the climate patterns. [MSS climate summary](https://www.weather.gov.sg/climate-climate-of-singapore/) |
| **Separate haze control from cooling** | NEA advises closing doors/windows as outdoor air worsens, reopening when it improves and using suitable portable filtration to reduce indoor particles. A purifier is a particle-removal device in this demo, not an AC or fresh-air supply. [NEA household FAQ, question 18](https://www.nea.gov.sg/our-services/pollution-control/air-pollution/faqs) |
| **Account for humidity when using AC** | Ventilation can add moisture that AC subsequently has to remove. A lower air temperature alone does not establish a lower total cooling load. PNNL explains this humid-climate penalty. [PNNL whole-house-fan guide](https://basc.pnnl.gov/resource-guides/whole-house-fans) |

DOE cautions that ventilation alone is not an effective general cooling strategy for hot, humid climates. That does not rule out conditional sensible cooling or fan comfort; it rules out promising that open windows replace AC in every Singapore scenario. [DOE Home Cooling](https://www.energy.gov/home-cooling)

## Fair “with / without” comparisons

Each pair should start from identical fields and use the same outdoor temperature, humidity, PM2.5, wind, heat sources, openings and simulated duration. Change only the named treatment; do not compare an already-cooled run against a fresh hot one.

| Pair | Question and expected physical check |
|---|---|
| Circulating fan off / on | Does air movement improve the comfort indicator or mix layers? In a closed, otherwise identical flat, the fan must not create net refrigeration. Mixing a hot upper layer may initially warm the occupied layer. |
| High exhaust off / on, make-up path open | With cooler, cleaner inlet air, does the model export upper-layer heat? Repeat with hotter or hazier inlet air to show the trade-off. |
| High exhaust with path blocked / open | Does actual exchange depend on a connected route? Show the assumed flow, not just an animated spinning fan. |
| West exposure / shading | With identical wind and devices, does reducing the solar source lower the added heat? The selected shading fraction is an assumption, not measured material performance. |
| Smaller / greater wall resistance | With the same temperature difference, does reduced conductance slow heat transfer? Reverse the temperature difference to show that insulation also slows outward heat loss. |

Report occupied-layer temperature, upper-layer temperature, their difference, PM2.5, actual simulated duration and estimated electricity together. Keep temperature separate from a comfort score. These are proposed teaching checks, not claims that every comparison has already passed.

## Requirements for an honest two-layer approximation

- Give each layer an explicit air volume and heat capacity. Apply interlayer heat exchange with equal and opposite energy changes; account for both inlet and exhaust enthalpy. A redistribution step must not create or destroy heat.
- Separate solar gains, wall conduction, air exchange, device heat and AC removal. If using `U × area × temperature difference`, disclose that this is a simplified envelope conductance, not a solved transient wall or radiation model.
- Treat layer boundaries, mixing rates, exhaust rates, shade fractions and conductance values as illustrative parameters until independently calibrated. Do not call the extension EnergyPlus, 3D CFD, a measured plume or a validated buoyancy solver.
- If humidity remains a fixed scenario value, label it clearly. No latent-load, condensation, dehumidification or health prediction follows from a temperature/PM2.5 model. The cardboard model and future switches are controls and visual aids, not thermal validation equipment.

The physical mechanisms above are established; their strength in this specific flat, the numerical coefficients and the proposed extension's accuracy remain unvalidated. No sensors or live environmental data are required for these demonstrations.

Written by gpt-6-astra in Codex on behalf of Edmund
