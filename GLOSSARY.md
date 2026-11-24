# ShipFlow

ShipFlow configures how a Shopify store changes existing delivery options or calculates new shipping prices at checkout.

## Language

**Operating mode**:
The one ShipFlow checkout runtime currently selected for a store. A store selects either Delivery Customization or CCS Rates, while configuration for the inactive mode remains saved.
_Avoid_: Plan, tier, Lite, Pro

**Delivery Customization**:
The operating mode that changes delivery options Shopify already produced, without creating a new shipping price.
_Avoid_: Lite, DC plan

**CCS Rates**:
The operating mode that returns new priced shipping options through Shopify Carrier Calculated Shipping.
_Avoid_: Pro, CCS plan

**Test Mode**:
A CCS Rates state intended to limit calculated-rate evaluation to documented test checkout identities before a store goes live.
_Avoid_: Trial, sandbox plan

**App status**:
Whether ShipFlow is enabled to evaluate checkout requests. Disabling it pauses checkout evaluation without deleting saved configuration.
_Avoid_: Installation status, subscription status

**Checkout decision order**:
The fixed sequence ShipFlow uses to decide whether checkout evaluation stops, returns calculated rates, or returns a configured fallback.
_Avoid_: Random fallback, best-effort order

**CCS readiness**:
Whether the Shopify store and its shipping configuration can call ShipFlow for calculated rates. An unknown status is treated as needing attention until verified.
_Avoid_: Pro eligibility, paid access

**Ready market**:
An active Shopify Market whose effective shipping configuration includes an active ShipFlow carrier-calculated rate provider. A market can inherit this provider from a parent Market.
_Avoid_: Enabled country, configured region

**Needs setup market**:
An active Shopify Market where ShipFlow is not currently an active rate provider.
_Avoid_: Broken market, failed market
