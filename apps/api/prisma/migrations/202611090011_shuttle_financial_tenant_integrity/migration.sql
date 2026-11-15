-- Shuttle A2 tenant-integrity guards. These triggers complement foreign keys,
-- which cannot express that every linked financial record belongs to one tenant.
-- They are additive and intentionally do not alter historic migrations 008-010.

-- Fail closed before installing guards: historic mismatches require an approved
-- correction plan, never a silent production migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Invoice" i JOIN "ShuttleBillingPeriod" p ON p."id" = i."shuttleBillingPeriodId" WHERE i."tenantId" <> p."tenantId")
    OR EXISTS (SELECT 1 FROM "Invoice" i JOIN "ShuttleSubscription" s ON s."id" = i."subscriptionId" WHERE i."tenantId" <> s."tenantId")
    OR EXISTS (SELECT 1 FROM "Payment" p JOIN "Invoice" i ON i."id" = p."invoiceId" WHERE p."tenantId" <> i."tenantId")
    OR EXISTS (SELECT 1 FROM "Payment" p JOIN "Invoice" i ON i."id" = p."invoiceId" WHERE (i."shuttleBillingPeriodId" IS NULL AND p."status" IS NOT NULL) OR (i."shuttleBillingPeriodId" IS NOT NULL AND p."status" IS NULL))
    OR EXISTS (SELECT 1 FROM "ShuttleSettlement" s JOIN "ShuttleBillingPeriod" p ON p."id" = s."billingPeriodId" WHERE s."tenantId" <> p."tenantId")
    OR EXISTS (SELECT 1 FROM "ShuttleSettlementPayment" sp JOIN "ShuttleSettlement" s ON s."id" = sp."settlementId" JOIN "Payment" p ON p."id" = sp."paymentId" JOIN "Invoice" i ON i."id" = p."invoiceId" WHERE s."tenantId" <> p."tenantId" OR s."billingPeriodId" IS DISTINCT FROM i."shuttleBillingPeriodId" OR p."status" IS DISTINCT FROM 'VERIFIED'::"ShuttlePaymentStatus")
  THEN
    RAISE EXCEPTION 'Shuttle financial tenant/period preflight failed; correct historical records before migration 011';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "novo_assert_invoice_shuttle_tenant_integrity"()
RETURNS TRIGGER AS $$
DECLARE expected_tenant TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD."tenantId" IS DISTINCT FROM NEW."tenantId" OR OLD."subscriptionId" IS DISTINCT FROM NEW."subscriptionId" OR OLD."shuttleBillingPeriodId" IS DISTINCT FROM NEW."shuttleBillingPeriodId") AND (OLD."shuttleBillingPeriodId" IS NOT NULL OR NEW."shuttleBillingPeriodId" IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'Invoice_shuttle_reparenting_check', MESSAGE = 'A Shuttle invoice cannot be reparented after creation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."shuttleBillingPeriodId" IS NOT NULL AND EXISTS (SELECT 1 FROM "ShuttleSettlement" WHERE "billingPeriodId" = OLD."shuttleBillingPeriodId") AND (
    OLD."status" IS DISTINCT FROM NEW."status" OR
    OLD."amount" IS DISTINCT FROM NEW."amount" OR
    OLD."description" IS DISTINCT FROM NEW."description" OR
    OLD."dueDate" IS DISTINCT FROM NEW."dueDate" OR
    OLD."issuedAt" IS DISTINCT FROM NEW."issuedAt" OR
    OLD."finalizedAt" IS DISTINCT FROM NEW."finalizedAt" OR
    OLD."finalizedById" IS DISTINCT FROM NEW."finalizedById" OR
    OLD."routeCodeSnapshot" IS DISTINCT FROM NEW."routeCodeSnapshot" OR
    OLD."routeNameSnapshot" IS DISTINCT FROM NEW."routeNameSnapshot" OR
    OLD."rateSnapshot" IS DISTINCT FROM NEW."rateSnapshot" OR
    OLD."proratedDays" IS DISTINCT FROM NEW."proratedDays" OR
    OLD."periodDays" IS DISTINCT FROM NEW."periodDays"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'Invoice_settled_snapshot_immutability_check', MESSAGE = 'A settled Shuttle invoice financial snapshot cannot be changed directly';
  END IF;
  IF NEW."shuttleBillingPeriodId" IS NOT NULL THEN
    SELECT "tenantId" INTO expected_tenant FROM "ShuttleBillingPeriod" WHERE "id" = NEW."shuttleBillingPeriodId" FOR SHARE;
    IF expected_tenant IS NULL OR expected_tenant <> NEW."tenantId" THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'Invoice_shuttleBillingPeriod_tenant_check', MESSAGE = 'Invoice tenant must match Shuttle billing period tenant';
    END IF;
  END IF;
  IF NEW."subscriptionId" IS NOT NULL THEN
    SELECT "tenantId" INTO expected_tenant FROM "ShuttleSubscription" WHERE "id" = NEW."subscriptionId" FOR SHARE;
    IF expected_tenant IS NULL OR expected_tenant <> NEW."tenantId" THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'Invoice_subscription_tenant_check', MESSAGE = 'Invoice tenant must match Shuttle subscription tenant';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Invoice_shuttle_tenant_integrity_trigger"
BEFORE INSERT OR UPDATE ON "Invoice"
FOR EACH ROW EXECUTE FUNCTION "novo_assert_invoice_shuttle_tenant_integrity"();

CREATE OR REPLACE FUNCTION "novo_assert_payment_invoice_tenant_integrity"()
RETURNS TRIGGER AS $$
DECLARE expected_tenant TEXT;
DECLARE invoice_period TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD."tenantId" IS DISTINCT FROM NEW."tenantId" OR OLD."invoiceId" IS DISTINCT FROM NEW."invoiceId") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'Payment_reparenting_check', MESSAGE = 'A payment cannot be reparented after creation';
  END IF;
  SELECT "tenantId", "shuttleBillingPeriodId" INTO expected_tenant, invoice_period FROM "Invoice" WHERE "id" = NEW."invoiceId" FOR SHARE;
  IF expected_tenant IS NULL OR expected_tenant <> NEW."tenantId" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'Payment_invoice_tenant_check', MESSAGE = 'Payment tenant must match invoice tenant';
  END IF;
  IF invoice_period IS NULL AND NEW."status" IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'Payment_generic_status_check', MESSAGE = 'A generic payment cannot use a Shuttle payment status';
  END IF;
  IF invoice_period IS NOT NULL AND NEW."status" IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'Payment_shuttle_status_check', MESSAGE = 'A Shuttle payment requires a Shuttle payment status';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'VERIFIED'::"ShuttlePaymentStatus" AND EXISTS (SELECT 1 FROM "ShuttleSettlementPayment" WHERE "paymentId" = OLD."id") AND (
    OLD."status" IS DISTINCT FROM NEW."status" OR
    OLD."amount" IS DISTINCT FROM NEW."amount" OR
    OLD."reference" IS DISTINCT FROM NEW."reference" OR
    OLD."method" IS DISTINCT FROM NEW."method" OR
    OLD."paidAt" IS DISTINCT FROM NEW."paidAt" OR
    OLD."verifiedAt" IS DISTINCT FROM NEW."verifiedAt" OR
    OLD."verifiedById" IS DISTINCT FROM NEW."verifiedById" OR
    OLD."reversedAt" IS DISTINCT FROM NEW."reversedAt" OR
    OLD."reversedById" IS DISTINCT FROM NEW."reversedById" OR
    OLD."reversalReason" IS DISTINCT FROM NEW."reversalReason"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'Payment_settled_snapshot_immutability_check', MESSAGE = 'An allocated Shuttle payment financial snapshot cannot be changed directly';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Payment_invoice_tenant_integrity_trigger"
BEFORE INSERT OR UPDATE ON "Payment"
FOR EACH ROW EXECUTE FUNCTION "novo_assert_payment_invoice_tenant_integrity"();

CREATE OR REPLACE FUNCTION "novo_assert_shuttle_settlement_tenant_integrity"()
RETURNS TRIGGER AS $$
DECLARE expected_tenant TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD."tenantId" IS DISTINCT FROM NEW."tenantId" OR OLD."billingPeriodId" IS DISTINCT FROM NEW."billingPeriodId") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'ShuttleSettlement_reparenting_check', MESSAGE = 'A Shuttle settlement cannot be reparented after creation';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    OLD."vendorNameSnapshot" IS DISTINCT FROM NEW."vendorNameSnapshot" OR
    OLD."vendorShareBps" IS DISTINCT FROM NEW."vendorShareBps" OR
    OLD."cooperativeShareBps" IS DISTINCT FROM NEW."cooperativeShareBps" OR
    OLD."verifiedAmount" IS DISTINCT FROM NEW."verifiedAmount" OR
    OLD."vendorAmount" IS DISTINCT FROM NEW."vendorAmount" OR
    OLD."cooperativeAmount" IS DISTINCT FROM NEW."cooperativeAmount"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'ShuttleSettlement_snapshot_immutability_check', MESSAGE = 'A Shuttle settlement financial snapshot cannot be changed directly';
  END IF;
  SELECT "tenantId" INTO expected_tenant FROM "ShuttleBillingPeriod" WHERE "id" = NEW."billingPeriodId" FOR SHARE;
  IF expected_tenant IS NULL OR expected_tenant <> NEW."tenantId" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'ShuttleSettlement_billingPeriod_tenant_check', MESSAGE = 'Settlement tenant must match billing period tenant';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ShuttleSettlement_tenant_integrity_trigger"
BEFORE INSERT OR UPDATE ON "ShuttleSettlement"
FOR EACH ROW EXECUTE FUNCTION "novo_assert_shuttle_settlement_tenant_integrity"();

CREATE OR REPLACE FUNCTION "novo_assert_shuttle_settlement_payment_integrity"()
RETURNS TRIGGER AS $$
DECLARE settlement_tenant TEXT;
DECLARE payment_tenant TEXT;
DECLARE settlement_period TEXT;
DECLARE payment_period TEXT;
DECLARE payment_status "ShuttlePaymentStatus";
BEGIN
  SELECT "tenantId", "billingPeriodId" INTO settlement_tenant, settlement_period FROM "ShuttleSettlement" WHERE "id" = NEW."settlementId" FOR SHARE;
  SELECT p."tenantId", i."shuttleBillingPeriodId", p."status" INTO payment_tenant, payment_period, payment_status FROM "Payment" p JOIN "Invoice" i ON i."id" = p."invoiceId" WHERE p."id" = NEW."paymentId" FOR SHARE OF p, i;
  IF settlement_tenant IS NULL OR payment_tenant IS NULL OR settlement_tenant <> payment_tenant OR settlement_period IS DISTINCT FROM payment_period OR payment_status IS DISTINCT FROM 'VERIFIED'::"ShuttlePaymentStatus" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'ShuttleSettlementPayment_tenant_period_check', MESSAGE = 'Settlement allocation payment must belong to the settlement tenant and billing period';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ShuttleSettlementPayment_tenant_integrity_trigger"
BEFORE INSERT OR UPDATE ON "ShuttleSettlementPayment"
FOR EACH ROW EXECUTE FUNCTION "novo_assert_shuttle_settlement_payment_integrity"();

CREATE OR REPLACE FUNCTION "novo_prevent_shuttle_parent_tenant_reparenting"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."tenantId" IS DISTINCT FROM NEW."tenantId" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'ShuttleFinancial_parent_tenant_reparenting_check', MESSAGE = 'Shuttle financial parent tenant cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ShuttleSubscription_tenant_reparenting_trigger"
BEFORE UPDATE ON "ShuttleSubscription"
FOR EACH ROW EXECUTE FUNCTION "novo_prevent_shuttle_parent_tenant_reparenting"();

CREATE OR REPLACE FUNCTION "novo_assert_shuttle_billing_period_lifecycle"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."tenantId" IS DISTINCT FROM NEW."tenantId" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'ShuttleFinancial_parent_tenant_reparenting_check', MESSAGE = 'Shuttle financial parent tenant cannot be changed';
  END IF;
  IF OLD."status" <> 'OPEN'::"ShuttleBillingPeriodStatus" AND (
    OLD."status" IS DISTINCT FROM NEW."status" OR
    OLD."startsAt" IS DISTINCT FROM NEW."startsAt" OR
    OLD."endsAt" IS DISTINCT FROM NEW."endsAt" OR
    OLD."timezone" IS DISTINCT FROM NEW."timezone"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'ShuttleBillingPeriod_finalized_immutability_check', MESSAGE = 'A finalized Shuttle billing period calendar cannot be changed directly';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ShuttleBillingPeriod_lifecycle_trigger"
BEFORE UPDATE ON "ShuttleBillingPeriod"
FOR EACH ROW EXECUTE FUNCTION "novo_assert_shuttle_billing_period_lifecycle"();
