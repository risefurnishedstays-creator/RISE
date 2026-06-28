// lib/leaseTemplate.js
//
// Holds the exact text of the RISE Furnished Stays residential lease
// (from 5907_Cougar_Drive_-_Residential_Lease.docx) and the Pet Addendum,
// with the document's blank fields ("___") replaced by real per-booking
// data. The legal wording itself is preserved verbatim -- only the
// genuinely variable fields (tenant name, unit letter, dates, rent total,
// pet description/fee) are substituted.
//
// Blank-to-data mapping, per the source document:
//   "made and entered into on ___"        -> today's date (lease generation date)
//   "Tenant means ___"                     -> guest's full name
//   "5907 Cougar Drive, unit __"           -> unit letter (A/B/D)
//   "from 3:00pm on ___ until 11:00am on ___" -> check-in date, check-out date
//   "total amount of $___"                 -> full stay total (rent + cleaning + pet fees)
//   Pet Addendum "keep ___ ('pets')"       -> pet description, only if pets > 0
//   Pet Addendum "total of $___"           -> total pet fee, only if pets > 0

const { cancellationCutoffDates, CONFIG, addDays } = require("./pricing");

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function fmtLongDate(d) {
  return MONTHS_LONG[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}

function parseKey(s) {
  const p = String(s).split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

/**
 * Builds the full lease body text (NOT including the Pet Addendum), with
 * every blank filled in from real booking data.
 *
 * @param {Object} params
 * @param {string} params.guestName
 * @param {string} params.unitCode - "A", "B", or "D"
 * @param {string} params.checkIn - "YYYY-MM-DD"
 * @param {string} params.checkOut - "YYYY-MM-DD"
 * @param {number} params.fullTotal - full stay total in dollars (rent + cleaning + pet fees)
 * @param {Date} [params.leaseDate] - defaults to today
 * @returns {string} plain text, \n for line breaks
 */
function buildLeaseText({ guestName, unitCode, checkIn, checkOut, fullTotal, dueToday, paymentDates, leaseDate }) {
  const today = leaseDate || new Date();
  const checkInDate = parseKey(checkIn);
  const checkOutDate = parseKey(checkOut);

  // ---- Payment schedule, inserted under section 3 (Rent) ----
  // dueToday is the first payment (first 30 nights + cleaning + pet fees,
  // due at booking); paymentDates is every subsequent installment, already
  // computed by priceParts() in lib/pricing.js -- not recalculated here,
  // just formatted, so the lease always matches what Stripe actually charges.
  let scheduleText = `Payment Schedule:\n${fmtLongDate(today)} (due at booking): $${dueToday.toLocaleString("en-US")}`;
  if (paymentDates && paymentDates.length) {
    for (const p of paymentDates) {
      scheduleText += `\n${fmtLongDate(parseKey(p.dateStr))}: $${p.amount.toLocaleString("en-US")} (${p.nights} nights)`;
    }
  }
  scheduleText += `\nTotal: $${fullTotal.toLocaleString("en-US")}`;

  // ---- Cancellation policy with this booking's real cutoff dates ----
  // Mirrors cancellationPolicyParagraph() in lib/emailTemplates.js exactly,
  // so the lease, the lease email, and the website all state the identical
  // policy with the identical dates for any given booking.
  const { fullRefundCutoff, partialRefundCutoff } = cancellationCutoffDates(checkIn);
  const earlyTermFee = 2550;
  const cancellationPolicyText = `Tenant agrees to the following cancellation terms for this stay:

More than 30 days before check-in: If Tenant cancels by ${fmtLongDate(fullRefundCutoff)}, Tenant's first month's rent, cleaning fee, and any pet fee(s) will be refunded in full.

30 days or fewer before check-in: If Tenant cancels between ${fmtLongDate(addDays(fullRefundCutoff, 1))} and ${fmtLongDate(partialRefundCutoff)}, the first month's rent is non-refundable. The cleaning fee and any pet fee(s) will be refunded in full.

After check-in (early termination): If Tenant terminates the stay early on or after ${fmtLongDate(checkInDate)}, the cleaning fee and any pet fee(s) become non-refundable, and one of the following applies, depending on when notice is given relative to the original check-out date of ${fmtLongDate(checkOutDate)} and Tenant's payment status:

(i) If Tenant gives notice more than 30 days before the original check-out date, Tenant shall pay an early termination fee of $${earlyTermFee.toLocaleString("en-US")}, reduced by a credit of $${CONFIG.NIGHTLY} for each night remaining, as of the notice date, in the payment period Tenant has most recently paid for.

(ii) If Tenant gives notice 30 days or fewer before the original check-out date, and Tenant's final scheduled payment for the stay has already been collected, no early termination fee applies; that final payment is retained by Landlord and is not refunded.

(iii) If Tenant gives notice 30 days or fewer before the original check-out date, and Tenant's final scheduled payment for the stay has not yet been collected, no early termination fee applies, but that final payment becomes due in full and will be charged to Tenant's card on file.

All cancellation requests must be submitted in writing to risefurnishedstays@gmail.com. Refunds, where applicable, will be issued to the original payment method within a few business days.`;

  return `RESIDENTIAL LEASE AGREEMENT

THIS RESIDENTIAL LEASE AGREEMENT (this "Lease") is made and entered into on ${fmtLongDate(today)} by and between Landlord (defined below) and Tenant (defined below). Landlord hereby leases to Tenant and Tenant hereby leases from Landlord the Premises (defined below), for and subject to the terms and provisions set forth in this Lease.

1. Parties and Premises.

As used in this Lease, "Landlord" means Richelle Dy.

As used in this Lease, "Tenant" means ${guestName}. The individuals comprising Tenant and the dependents of such individuals, as set forth below, shall be the only occupants of the Premises.

As used in this Lease, "Premises" means that certain residence situated in Travis County, Texas and having an address of 5907 Cougar Drive, unit ${unitCode}, Austin, TX 78745.

2. Term. Subject to the terms and provisions of this Lease, Landlord leases the Premises to Tenant from 3:00 p.m. on ${fmtLongDate(checkInDate)} until 11:00 a.m. on ${fmtLongDate(checkOutDate)} (the "Term").

3. Rent.

(A) Rent for the Premises shall be paid in monthly installments for a total amount of $${fullTotal.toLocaleString("en-US")} without notice or demand ("Rent"), including a one-time cleaning fee of $150 and any applicable pet fee(s). Rent is due on the stated dates. Any payments paid after the 2nd day of stated dates shall be deemed late. Any late payments shall be charged a $75 late fee for the first day rent is late. An additional fee of $25 per day shall be assessed for each additional day Rent is late, until Rent is paid in full. Notwithstanding the above, the total late fee assessed for any month will not exceed 10% of the total of one month's rent for the rented premises. All late fees shall be deemed Additional Rent payable by Tenant.

${scheduleText}

Payments shall be deemed received when actually delivered to, and received by, Landlord at the payment location. A fee of $100 shall be applied by Landlord to any dishonored check, which fee shall be deemed Additional Rent. Any additional bank and handling charges that are assessed in the event of a dishonored check shall also be deemed Additional Rent. Landlord may require Tenant to replace any dishonored check with a money order, cashier's check, or bank check. Landlord may further require that all subsequent payments after a dishonored check be paid with a money order, cashier's check, or bank check.

Acceptable forms of payment of Rent (including Additional Rent) are personal check, cashier's check, bank check, and the following online/ACH payment methods: Zelle/Venmo/Credit Card, or any other method of payment Landlord designated during the course of this Lease. No other forms of payment will be accepted by Landlord. If paying by credit card, the Tenant is responsible for applicable credit card fees.

4. Security Deposit. Contemporaneously with the execution of this Lease, Tenant shall deposit with Landlord a security deposit in the amount of $0 as security for the return of the Premises at the expiration of the term of this Lease in as good condition as when Tenant took possession of the Premises, normal wear and tear excepted, as well as the faithful, timely and complete performance of all other terms, conditions and covenants of the Lease. Landlord may retain the Security Deposit for nonpayment of Rent or Additional Rent, damage to the Premises, replacement of damaged or missing items on the Premises, and/or cleaning of the Premises beyond normal wear and tear, to perform any obligation Tenant fails to perform under this Lease, or in connection with Landlord's remedies under this Lease. Tenant may not elect to use the Security Deposit as payment for any rent Tenant owes under this Lease. Any amount remaining from the Security Deposit, together with a written accounting for any portion retained, will be returned by mail to Tenant not more than thirty (30) days after expiration of the Term. Landlord shall mail the return or accounting to the forwarding address provided by Tenant or, if no forwarding address has been provided, to Tenant's last known address. If Tenant consists of more than one person, Tenant agrees that Landlord may provide, at Landlord's discretion, the return or accounting to one representative of Tenant or pro-rata refunds to each person.

5. Utility Bills/Service Contracts: Landlord and Tenant agree that utility bills and service contracts ("Service Obligations") for the Premises shall be paid by the Landlord. The party agreeing to be responsible for payment of a Service Obligation agrees to timely pay the applicable Service Obligation, including any metering, hook-up fees or other miscellaneous charges associated with establishing, installing and maintaining such utility or contract in that party's name. Utilities include: Water/Sewer, Gas, Electricity, Internet, and Trash Disposal.

6. Furnishings and Appliances.

(A) The following appliances are supplied with the Premises: Refrigerator, Stove/Oven, Dishwasher, Microwave, Washer, and Dryer. Tenant agrees to keep all such appliances clean and in good repair, ordinary wear and tear accepted. Supplied appliances may not be removed from the Premises.

(B) A list of furnishings supplied with the Premises is attached below. If any furnishings break or are damaged, they are Tenant's responsibility. Landlord shall not have any obligation to repair or replace the furnishings. Maintenance of the furnishings is Tenant's sole responsibility, and Tenant will keep all such furnishings in good repair, ordinary wear and tear accepted. Tenant's use of such furnishings shall be "AS-IS", and Landlord has not made, does not make and hereby disclaims any representations or warranties (including, without limitation, any warranty of merchantability or fitness for a particular purpose) as to the physical condition of the furnishings or the suitability or usefulness of the furnishings for Tenant's intended use. The furnishings may not be removed from the Premises. Tenant acknowledges that they have had the opportunity to inspect the furnishings prior to executing this Lease.

Living Room: Sofa, coffee table, end table, TV, TV stand
Kitchen: Bar stools x2
Dining Room: Dining table, dining chairs x4, artwork
Bedroom 1: Queen-sized bed, night stands x2, artwork, desk, chair, sofa chair, end table
Bedroom 2: Queen-sized bed, night stands x2, artwork, desk, chair

7. Use of Premises. The individual identified as the "Tenant" in Section 1 of this Lease is the sole signatory to and party responsible under this Lease. The Premises may be occupied only by the Tenant and the additional guests listed in the reservation or otherwise approved in writing by Landlord. No other person may occupy the Premises without Landlord's prior written consent. Tenant shall be liable for any acts or omissions of Tenant's guests. If Tenant desires any change or increase to those shown as Tenants in the Lease, and provided any increase is not in violation of applicable occupancy codes, those individuals desiring tenancy must complete any application and approval process required by Landlord, in advance of any change, and after Landlord's approval must execute a new Lease. If Tenant fails to obtain Landlord's approval in advance of any change in occupancy, Tenant understands that this failure constitutes a Default as described in the Lease. Tenant agrees to comply with and abide by all federal, state, county and municipal laws and ordinances in connection with the occupancy and use of the Premises. No alcoholic beverages shall be possessed or consumed by Tenant, or Tenant's licensees or invitees, unless the person possessing or consuming alcohol is of legal age. No illegal drugs or controlled substances (unless specifically prescribed by a physician for a specific person residing or present on the Premises) are permitted on the Premises. Tenant agrees to refrain from using the Premises in any way that may result in an increase of the rate or cost of insurance on the Premises. No hazardous or dangerous activities are permitted on the Premises. Tenant shall not use the Premises in a manner that may endanger the person or property of Landlord, co-tenants, or any person living on or near the Premises. Tenant agrees to limit use of the Premises to those uses consistent with the Premises' clean, safe, sanitary, and habitable condition. Tenant shall only use outdoor cooking implements in a safe manner, shall maintain a safe distance between any cooking implement and any structure, and shall store any hazardous material including propane in a safe place, outside of any structures included in this Lease. Neither Tenant nor Tenant's licensees or invitees shall be a nuisance or act in any manner that would interfere with the quiet enjoyment by adjacent property owners. This prohibition includes, but is not limited to, loud noises, loud music, noxious or unpleasant odors, and disruptive behavior or actions.

8. Pets. Unregistered pets are not allowed to reside in the Premises, unless written permission is granted by Landlord before the pet is moved in, which permission may be granted or withheld in Landlord's sole and absolute discretion. Pets will be subject to an upfront deposit of $500, in line with clause no. 4. Refer to Pet Addendum.

9. Parking. A parking lot at the Premises is available for the Tenant. Vehicles parked at the Premises must be in working, drivable condition. Tenant may not repair Tenant's vehicles on the Premises or the surrounding property if such repairs take longer than one (1) day, unless in an enclosed parking garage. Vehicles may never, under any condition, be parked in or driven on the yard of the Premises. Tenant may not park more than two (2) vehicles at the Premises. In no event shall Landlord be liable for any damage or loss to Tenant's vehicles or to any personal property contained in such vehicles.

10. Surrender of Premises. Tenant will return the Premises to Landlord at the expiration of the Term in as good condition as when Tenant took possession of the Premises, normal wear and tear excepted. Any deterioration or damage caused by accident, abuse, carelessness, or negligence shall not be considered normal wear and tear. If Tenant fails to re-deliver the Premises in appropriate condition, Landlord may restore the Premises to appropriate condition, including repair, replacement and cleaning. The cost of any work necessitated will be deducted from the Security Deposit, and if the Security Deposit is insufficient to cover work performed, Tenant will be obliged to pay the additional balance.

11. Condition of Systems and Appliances on Premises. All systems and appliances on the Premises, including refrigerators, stoves, microwaves, dishwashers, washers, dryers, water heaters, furnaces, etc., will be deemed to be in working condition at the commencement of the Term, unless specifically noted by the Tenant. As of the commencement of the Lease, Tenant acknowledges that Tenant has examined the Premises and is satisfied with the condition of the Premises, including all systems and appliances on the Premises. Taking possession of the Premises by Tenant is conclusive evidence to the fact that the Premises are in good order and satisfactory condition.

12. Subletting; Assignment; Airbnb and Other Similar Sharing Services. Tenant shall neither sublet any part of the Premises nor assign the Lease, nor any interest in the Lease, without Landlord's prior written consent. Consent to a sublease or assignment shall be in the sole and absolute discretion of Landlord. Tenant may not list the Premises on Airbnb or similar service.

13. Tenant's Maintenance and Care of the Premises.

(A) In addition to the duties imposed upon Tenant by this or other provisions of this Lease, Tenant shall at all times maintain the Premises in good condition and in reasonably clean and safe manner. In addition, Tenant shall not knowingly, intentionally, deliberately, or negligently destroy, deface, damage, impair, or remove any part of the Premises or knowingly permit any person within Tenant's control to do so. Tenant shall use felt pads, rugs or similar scratch prevention materials under all furniture items or other items placed upon any hard surface flooring in the Premises. Bathmats or rugs shall be used on the floors in all bathrooms in the Premises to help prevent standing water on such floors. Tenant shall not place any additional locks on the Premises, including, but not limited to, exterior and interior doors. Landlord shall provide a key to the Tenant for the Premises and Landlord shall keep a duplicate key for access with reasonable notice. Tenant shall not cause any of the locks or cylinders in the locks to be changed or re-keyed in any manner. Tenant must keep the Premises free and clear of all debris, garbage and rubbish.

(B) Except as may otherwise be permitted by applicable law, Tenant shall not perform or contract with third parties to perform any repairs of any kind on the Premises without the prior written consent of Landlord. If any repair which is the responsibility of either Tenant or Landlord becomes necessary, Tenant shall notify Landlord, in writing, as soon as possible and allow reasonable time for the work to be completed. Any unauthorized work performed or contracted for by Tenant will be at Tenant's sole expense and no deductions or offsets in Rent or Additional Rent will be permitted.

(C) Tenant shall not make any additions, improvements, or alterations to the Premises unless prior written consent is given by Landlord, which may be given or withheld in Landlord's sole and absolute discretion. Any additions, improvements, or alterations made by Tenant must be completed in compliance with all local, state, and federal laws. As used herein "additions, improvements, or alterations" includes, without limitation, lock changes, painting, replacing fixtures, installing wallpaper, attaching shelves, installing curtains or shades, or other permanent or semi-permanent changes to the Premises. Additionally, no trampolines, pools, satellite dishes, TV antennas, air conditioners, spas, swing sets, or other similar features shall be added to the Premises by Tenant unless express written permission is given by Landlord, which permission may be granted or withheld in Landlord's sole and absolute discretion.

(D) Tenant shall be responsible for all costs related to any repair or maintenance of any plumbing stoppage or slow-down caused by Tenant, whether accidental or purposeful, that is the result of any usage that would cause normal wear and tear. Tenant agrees not to place into any drain lines of the Premises any non-approved substances, such as cooking grease, sanitary napkins, diapers, children's toys or other similar object that may cause a stoppage. Tenant is expressly prohibited from placing any feminine hygiene or paper towel products in the drain line, and hereby acknowledges that doing so may cause significant damages to the premises, all of which Tenant shall be and hereby admits to liability and responsibility for. Tenant shall notify Landlord of any plumbing leak or slow drainage within twenty-four (24) hours. Landlord shall use reasonable efforts to remedy the plumbing problem. Tenant shall only use a plunger to attempt to fix a slow or stopped drain, and shall not pour chemical or other drain cleaners into any stopped or slow drains. Tenant shall also be responsible for any plumbing system freeze-ups occasioned by Tenant's negligence.

(E) It is generally understood that mold spores are present essentially everywhere and that mold can grow in most any moist location. Landlord has informed Tenant of the need for prevention of moisture in the Premises and on good housekeeping and ventilation practices. Tenant acknowledges the necessity of housekeeping, ventilation, and moisture control (especially in kitchens, bathrooms, and around outside walls) for mold prevention. In signing this Lease, Tenant has examined the Premises and certifies that Tenant has not observed mold, mildew or moisture within the Premises, unless otherwise noted during the move-in walkthrough. Tenant agrees to immediately notify Landlord if it observes mold/mildew and/or moisture conditions (from any source, including leaks), and allow Landlord to evaluate and make recommendations and/or take appropriate corrective action. Tenant relieves Landlord from any liability for any bodily injury or damages to property caused by or associated with moisture or the growth of or occurrence of mold or mildew on the Premises. In addition, execution of this Lease constitutes acknowledgement by Tenant that control of moisture and mold prevention are an important part of Tenant's Lease obligations.

(F) Pest control, after the first ten (10) days of the Term of this Lease, shall be the sole responsibility of the Tenant, including, without limitation, prevention and remediation. Tenant shall keep the Premises free of all pests, including without limitation, rodents, fleas, bed bugs, ants, cockroaches, gnats, flies, and beetles. Tenant shall pay for all costs associated with remediating pests from the Premises and shall inform Landlord at first sighting of any pests in order to avoid any infestation of pests. In signing this Lease, Tenant agrees that Tenant has examined the Premises and certifies that it has not observed any pests in the Premises, unless otherwise noted in the move-in walkthrough.

(G) To the maximum extent permitted by law, Tenant shall not be permitted to, and shall not permit any family, visiting friends, dependents, guests, licensees or invitees of Tenant to grow, produce, possess, consume, use, smoke, or ingest any illegal drugs or narcotics on or about the Premises. Tenant's violation of this Section shall be an immediate and incurable Default of this Lease.

(H) No ice melt, salt or similar product may be used on the Premises. Any damage to the Premises (including, without limitation, concrete walkways and stairs) caused by Tenant's use of ice melt, salt or similar product shall be the sole responsibility of Tenant, and Tenant shall be responsible for the cost and expense any repairs required as a result thereof.

(I) Tenant is not responsible for lawn/yard maintenance and snow removal.

(J) If Tenant changes the locks without supplying Landlord with a key, and Landlord is prevented from entering the Premises due to the lock change, Tenant shall be responsible for all costs of Landlord to enter the Premises by force, including, without limitation, any damage to the Premises.

(K) The Premises has been equipped with battery powered smoke detectors and carbon monoxide detectors. Tenant agrees these detectors are in working order and agrees to periodically test and maintain the smoke detectors and keep them in working order.

14. Landlord's Maintenance of the Premises. Landlord agrees to maintain the structure, roof and foundation of the Premises, and the heating, plumbing and electrical systems of the Premises unless the repairs required are a result of any act or omission of Tenant (excluding normal wear and tear). In such case that the damage is a result of the act or omission of Tenant, Tenant will be responsible for all costs to repair such damage. Landlord will carry out all required repairs in as reasonable time as possible in accordance to applicable laws but will not be liable to Tenant for any disruptions or inconvenience to Tenant as a result of damages or repairs or any claim that the Premises is uninhabitable, except to the extent of any non-waivable warranty of habitability provided by applicable laws.

15. Default. If Tenant is late in the payment of any installment of Rent or Additional Rent, or in violation of any other covenants or agreements set forth in the Lease (a "Default") and the Default remains uncorrected for a period of 5 days, then Landlord may, at Landlord's option, undertake any of the following remedies without limitation: (i) declare the Term of the Lease ended; (ii) terminate Tenant's right to possession of the Premises and re-enter and repossess the Premises pursuant to applicable provisions of the Texas Property Code; (iii) recover all present and future damages, costs and other relief to which Landlord is entitled; (iv) pursue Landlord's lien remedies; (v) pursue breach of contract remedies; and/or (vi) pursue any and all available remedies in law or equity. If possession is terminated by reason of a Default before the Term expires, Tenant shall pay the flat fee of $2,550 as an Early Termination Fee, which shall become immediately due upon a deceleration of Default.

Additionally, Pursuant to Texas law, if an event of Default(s) occur under the Lease, Landlord may terminate Tenant's possession upon a written 3-day Notice to Quit, without a right to cure. Upon such termination, Landlord shall have available any and all of the above-listed remedies.

Notwithstanding the above, Tenant may terminate this lease and avoid the lease obligations under this lease, if Tenant surrenders the premises under Section 92.016 of the Texas Property Code following a qualifying occurrence of family violence, or Section 92.0162 of the Texas Property Code following the death of the Tenant.

Further, upon an event of Default, Tenant agrees to cooperate fully, and be proactive in, any application, or process to apply for, any government rent and/or utility funding programs. Failure by Tenant to comply with this provision, shall entitle Landlord to any and all damages for said failure.

16. Abandonment. The Premises will be deemed abandoned if Tenant Defaults in Rent payment, appears absent from the Premises, and there is reason to believe that Tenant will not be returning to the Premises, as determined by Landlord in its reasonable discretion.

17. Re-Entry. If Landlord re-enters the Premises as a result of abandonment, or a Default by Tenant and which results in an order of the court for removal of the Tenant following a forcible entry and detainer suit:

(A) Tenant shall be liable for damages to Landlord for all loss sustained, including, without limitation, the balance of the Rent and Additional Rent due for the remainder of the Term, court costs and reasonable attorneys' fees;

(B) Tenant's personal property and the personal property of any guest, invitee, licensee or occupant may be removed from the Premises, by law enforcement officer(s), and left on adjacent to the rental property or, and stored at a storage facility, at the discretion of said law enforcement officers(s). Any expense related to storage of Tenant's personal property is the sole responsibility of Tenant. Landlord shall not be deemed a bailee of the removed property, and Landlord shall not be held liable for either civil or criminal action as a result of the removal and Landlord shall not be liable for damages to the Tenant resulting from the execution of a writ of possession by an officer acting under the law. Tenant shall indemnify Landlord for any expense in defending against any claim by Tenant or third-party and for any legal expense, cost, fine or judgment awarded to any third-party as a result of Landlord's actions pursuant to this Section of the Lease;

(C) NOTWITHSTANDING THE ABOVE, LANDLORD HEREBY HAS AND SHALL HOLD A LANDLORD'S LIEN AGAINST ALL NON-EXEMPT PROPERTY OF THE TENANT, IN THE CASE THAT TENANT BECOMES DELINQUENT IN THEIR RENT PAYMENT OBLIGATIONS. FURTHER, LANDLORD SHALL BE ENTITLED TO ALL COSTS ASSOCIATED WITH EXERCISE OF THIS LIEN RIGHT, INCLUDING BUT NOT LIMITED TO, LABOR FOR PACKING, REMOVING, OR STORAGE OF THE PROPERTY SEIZED. IF TENANT CONTINUES TO REMAIN DELINQUENT FOR THEIR RENT PAYMENT OBLIGATION FOR 30 DAYS AFTER THE LANDLORD HAS SEIZED TENANT'S PROPERTY, PER THIS LIEN, LANDLORD MAY SELL ANY AND ALL OF THE SEIZED PROPERTY TO SATISFY THE OUTSTANDING RENT PAYMENT OBLIGATION OF TENANT. NOTICE OF THE SEIZURE AND SALE WILL BE PROVIDED PER APPLICABLE STATE AND LOCAL LAW, AND TO THE PREMISES OF THE RENTAL PROPERTY. TENANT HEREBY AGREES THAT SAID NOTICE LOCATION SHALL SUFFICE FOR ALL NOTICE REQUIREMENTS.

(D) Landlord will attempt to re-let the Premises for such rent and under such terms as are reasonably appropriate and in accordance with the Texas Property Code;

(E) Landlord will enter the Premises, clean and make repairs and charge Tenant accordingly;

(F) Any money that Landlord receives from Tenant shall be applied first to Rent, Additional Rent, and other payments due; and

(G) Tenant will surrender all keys and peacefully surrender and deliver up possession of the Premises.

18. Default by Landlord. In the event of any alleged default in the obligation of Landlord under this Lease, Tenant will deliver to Landlord written notice specifying the nature of Landlord's default and Landlord will have a reasonable amount of time following receipt of such notice to cure such alleged default.

19. Indemnification; Insurance.

(A) Tenant shall indemnify, defend, and save Landlord harmless from all injury, loss, claim or damage to any person or property while on the Premises, or arising in any way out of Tenant's use or occupancy of the Premises, including the transmission from or to any persons, of the Covid-19 virus, or any other communicable disease. Landlord and Landlord's agents, contractors, and employees shall not be liable for, and Tenant waives all claims for, damage to person or property sustained by Tenant, resulting from any accident or occurrence in, on or about the Premises, including, but not limited to, claims for damage resulting from: (i) any equipment or appurtenances becoming out of repair; (ii) Landlord's failure to keep the Premises in repair; (iii) injury done or occasioned by wind, water, or other natural element; (iv) any defect in, or failure of, plumbing, heating or air-conditioning equipment, electric wiring or installation thereof, gas, water and steam pipes, stairs, porches, railings or walks; (v) broken glass; (vi) the backing-up of any sewer pipe or downspout; (vii) the bursting, leaking or running of any tank, tub, sink, sprinkler system, water closet, waste pipe, drain or any other pipe or tank in, on or about the Premises; (viii) the escape of steam or hot water; (ix) water, snow, or ice being on or coming through the roof, skylight, doors, stairs, walks, or any other place on or near the Premises; (x) the falling of any fixtures, plaster or stucco; (xi) fire or other casualty; (xii) any act, omission or negligence of co-tenants or of other persons or occupants of the Premises; and (xiii) any hazardous materials or conditions on the Premises; (xiv) any transmission, to or from any person, or object, of the Covid-19 Virus or any other communicable disease.

Landlord, in its sole discretion and for its sole benefit, shall cause the Premises to be insured as it deems appropriate. Tenant shall have no right or claim to any insurance or insurance proceeds of Landlord. Tenant understands and agrees that Landlord has no obligation to obtain insurance for Tenant including, but not limited to, liability, hazard, or contents insurance.

20. Holdover. Tenant must vacate the Premises and remove all of Tenant's personal property from the Premises before 11:00 a.m. on the date the Term expires. If Tenant fails to so vacate the Premises, Landlord may immediately commence eviction proceedings at its sole discretion.

21. Entry by Landlord. Landlord may enter the Premises (or cause its agents or contractors to enter the Premises) at reasonable hours for reasonable purposes (such as repairs, inspections or re-letting to prospective new tenants), after giving reasonable notice to Tenant. Landlord may also enter the Premises in the event of an emergency, without notice, or in the event of Tenant's abandonment of the Premises. Tenant's request for service or repairs shall be considered Tenant's approval of all necessary access to the Premises by Landlord or Landlord's agents or contractors, in connection with such service or repairs. If Tenant does not allow access to the Premises when Landlord or Landlord's agents or contractors have agreed to perform any services or repairs to the Premises, Tenant will be assessed a $150 service charge. Landlord may also display "For Rent" or "For Sale" signs on the Premises, including, without limitation, in the windows of the Premises or the front yard.

22. Subordination. The Lease is subordinate to all existing and future mortgages, deeds of trust and other security interests on the Premises. Tenant agrees that from time to time it will deliver to Landlord or Landlord's mortgagee or designee within ten (10) days of the date of Landlord's or Landlord's mortgagees or such other designee's request documentation confirming the subordination of this Lease to any current or future mortgage or mortgages placed on the Premises by Landlord and Tenant's agreement to attorn to any party acquiring rightful possession of the Premises by or through any such mortgage.

23. Miscellaneous.

(A) All notices required to be sent under the Lease must be in writing and either be: (i) delivered as provided by applicable law; (ii) personally delivered, with proper proof of service; or (iii) sent via any trackable form of delivery by the U.S. Postal Service or private delivery service. All notices required to be sent to Landlord must be sent or delivered to the address where the Rent is to be paid, and all notices required to be sent to Tenant may be sent or delivered to the Premises.

(B) In the event that Landlord commences legal action against Tenant to enforce any part of this Lease or applicable laws, Landlord shall be entitled to recover all costs and reasonable attorneys' fees incurred by Landlord in connection therewith.

(C) The Lease is governed by and construed in accordance with the laws of the State of Texas. Venue is proper in the County in which the Premises are located.

(D) This Lease and any attached exhibits or addendums constitute the entire agreement between parties. Unless otherwise provided in this Lease, this Lease may be amended, modified, or terminated only by a written instrument executed by Landlord and Tenant.

24. Additional Clauses.

(A) Tenant must abide by the house rules, as follows:

- Do not flush anything down the toilet except toilet paper -- no flushable wipes. Tenant is responsible for plumbing costs from clogs.
- No smoking, vaping, or drugs anywhere on the property.
- No parties or loud music.
- No unregistered pets or guests.
- Quiet hours are 11:00 PM to 7:00 AM.
- Take care of the furniture, keep it clean, and do not move furniture around.
- After a wash cycle, leave the washing machine door open to prevent mold.
- Keep all doors closed to keep insects out. When entering at night, keep inside lights off and the outside light on to deter insects.
- Please turn off the lights when not in use.
- Place garbage in the brown bins, recycling in the blue bins, in front of the house. Make sure to place the garbage inside the bins. Otherwise, an "extra trash sticker" from the convenience store is required.
- Where applicable, do not leave your pet unattended at any time -- pets should not be left alone in the unit.
- Where applicable, pick up after your pet and clean up any messes they make.

(B) ${cancellationPolicyText}

IN WITNESS WHEREOF, the parties have executed this Lease as of the day and year provided with their respective signatures below.`;
}

/**
 * Builds the Pet Addendum text, only relevant when the booking includes
 * pets. Returns null if pets is 0 -- caller should omit the addendum
 * entirely in that case (no pet section appears in the lease at all).
 *
 * @param {Object} params
 * @param {number} params.pets - number of pets
 * @param {number} params.petFeeTotal - total pet fee in dollars ($50 per pet)
 * @param {string} [params.petDescription] - e.g. "1 dog" -- defaults to a generic count if not provided
 * @returns {string|null}
 */
function buildPetAddendumText({ pets, petFeeTotal, petDescription }) {
  if (!pets || pets <= 0) return null;
  const description = petDescription || (pets === 1 ? "1 pet" : `${pets} pets`);

  return `This Pet Addendum ("Addendum") is made part of and incorporated into the Lease:

1. Tenant's Pet. Tenant desires to keep ${description} ("pets") in the Premises.

Because the Lease specifically prohibits keeping pets in the Premises without Landlord's prior written consent, Tenant agrees to the terms and conditions of this Addendum in exchange for Landlord's agreement to permit Tenant to keep the pets in the Premises.

2. Pet Fees. Concurrently with Tenant's execution of this Addendum, Tenant shall pay Landlord an additional non-refundable pet fee of $50 per pet for a total of $${petFeeTotal.toLocaleString("en-US")}. This is not refundable before the lease ends, even if the pet is removed.

3. Pet Rules and Responsibilities. Tenant agrees to:
- Keep the pet under control at all times.
- Properly clean and dispose of pet waste.
- Prevent excessive noise, odor, or disturbances.
- Ensure the pet does not damage the property or common areas.
- Comply with all local laws, ordinances, and licensing requirements.

4. Damage and Liability. Tenant is fully responsible for any damage caused by the pet, including but not limited to carpets, flooring, walls, landscaping, and fixtures. Tenant agrees to indemnify and hold Landlord harmless from any claims, damages, or injuries caused by the pet, including injuries to persons or other animals.

5. Inspection and Repairs. Landlord reserves the right to inspect the premises with proper notice to assess pet-related damage. Tenant agrees to promptly pay for repairs or cleaning required due to pet damage.

6. Removal of Pet. Landlord may require permanent removal of the pet if Tenant violates this Addendum, the Lease, or if the pet poses a threat, causes damage, or creates a nuisance.

7. No Waiver. Landlord's acceptance of rent or failure to enforce any provision of this Addendum does not constitute a waiver of the right to enforce such provisions in the future.

8. Entire Agreement. This Addendum, together with the Lease, constitutes the entire agreement regarding pets. In the event of a conflict, this Addendum shall control.

9. Governing Law. This Addendum shall be governed by the laws of the state of Texas.

10. Severability. If any provision of this Addendum is held invalid or unenforceable, the remaining provisions shall continue in full force and effect.

By signing below, the parties agree to all terms of this Pet Addendum.

IN WITNESS WHEREOF, the parties have executed this Pet Addendum as of the day and year provided with their respective signatures below.`;
}

module.exports = { buildLeaseText, buildPetAddendumText, fmtLongDate, parseKey };
