"""All data-entry forms. Validation happens here, on the server."""
from datetime import date

from flask_wtf import FlaskForm
from wtforms import (BooleanField, DecimalField, IntegerField, SelectField, StringField,
                     TextAreaField)
from wtforms.fields import DateField
from wtforms.validators import DataRequired, InputRequired, Length, NumberRange, Optional, ValidationError

from app.models.bill import BILL_CATEGORIES, RESPONSIBLE, TENANT_PAYMENT_STATES
from app.models.personal import (EXPENSE_CATEGORIES, FREQUENCIES, INCOME_KINDS, INVESTMENT_TYPES,
                                 KINDS, STATUSES)
from app.models.property import COLLECTORS, OCCUPANCY_STATUSES
from app.models.utility import CONNECTION_KINDS

METHODS = ["", "Cash", "UPI", "Bank transfer", "Cheque", "Card", "Auto-debit", "Other"]


def opt_int(value):
    return int(value) if value not in (None, "", "None") else None


def apply_form(form: FlaskForm, obj, skip=()) -> None:
    """Copy form data onto a model; blank text becomes NULL so optional fields stay blank."""
    for name, field in form._fields.items():
        if name == "csrf_token" or name in skip or not hasattr(type(obj), name):
            continue
        value = field.data
        if isinstance(value, str):
            value = value.strip() or None
        setattr(obj, name, value)


def money(label, required=True, **kw):
    validators = [InputRequired() if required else Optional(), NumberRange(min=0, max=10**11)]
    return DecimalField(label, places=2, validators=validators, **kw)


def positive_money(label):
    return DecimalField(label, places=2, validators=[InputRequired(), NumberRange(min=0.01, max=10**11)])


def text(label, required=False, max_len=200, **kw):
    return StringField(label, validators=[DataRequired() if required else Optional(), Length(max=max_len)], **kw)


def notes():
    return TextAreaField("Notes", validators=[Optional(), Length(max=4000)])


def method_field():
    return SelectField("Payment method", choices=[(m, m or "—") for m in METHODS], validators=[Optional()])


class PropertyForm(FlaskForm):
    name = text("Room / property name", required=True, max_len=120)
    mhada_room_no = text("MHADA room number", max_len=60)
    ward_name = text("Ward name", max_len=120)
    ward_number = text("Ward number", max_len=30)
    address = TextAreaField("Address", validators=[Optional(), Length(max=1000)])
    occupancy_status = SelectField("Occupancy", choices=OCCUPANCY_STATUSES)
    property_type = text("Property type", max_len=60)
    ownership = text("Ownership / relationship", max_len=120)
    rent_collected_by = SelectField("Rent is collected by", choices=COLLECTORS)
    area_sqft = DecimalField("Area (sq ft)", places=2, validators=[Optional(), NumberRange(min=0)])
    space_details = TextAreaField("Space / room details", validators=[Optional(), Length(max=2000)])
    notes = notes()


class ConnectionForm(FlaskForm):
    kind = SelectField("Type", choices=CONNECTION_KINDS)
    provider = text("Provider (e.g. Adani Electricity, MGL)", max_len=120)
    nickname = text("Nickname", max_len=120)
    consumer_no = text("Consumer / connection number", max_len=60)
    meter_no = text("Meter number", max_len=60)
    is_active = BooleanField("Active", default=True)
    notes = notes()


class TenantForm(FlaskForm):
    name = text("Tenant name", required=True, max_len=120)
    phone = text("Phone", max_len=40)
    email = text("Email", max_len=120)
    start_date = DateField("Tenancy start", validators=[Optional()])
    end_date = DateField("Tenancy end", validators=[Optional()])
    monthly_rent = money("Monthly rent (₹)")
    rent_due_day = IntegerField("Rent due day of month", default=5,
                                validators=[InputRequired(), NumberRange(min=1, max=31)])
    security_deposit = money("Security deposit (₹)", required=False)
    increment_percent = DecimalField("Planned yearly increment (%)", places=2,
                                     validators=[Optional(), NumberRange(min=0, max=100)])
    next_increment_date = DateField("Next increment due on", validators=[Optional()])
    is_active = BooleanField("Current tenant", default=True)
    notes = notes()

    def validate_end_date(self, field):
        if field.data and self.start_date.data and field.data < self.start_date.data:
            raise ValidationError("End date can't be before the start date.")


class RevisionForm(FlaskForm):
    effective_from = DateField("Effective from", validators=[InputRequired()], default=date.today)
    new_rent = positive_money("New monthly rent (₹)")
    reason = text("Reason", max_len=200)
    next_increment_date = DateField("Next increment due on (optional)", validators=[Optional()])


class PaymentForm(FlaskForm):
    amount = positive_money("Amount (₹)")
    paid_on = DateField("Payment date", validators=[InputRequired()], default=date.today)
    method = method_field()
    reference = text("Transaction reference", max_len=120)
    notes = notes()
    advance_due = BooleanField("Move the next due date forward", default=True)

    def validate_paid_on(self, field):
        if field.data and field.data > date.today():
            raise ValidationError("A payment date can't be in the future.")


class BillForm(FlaskForm):
    property_id = SelectField("Property", coerce=int)
    connection_id = SelectField("Connection (optional)", coerce=opt_int, validators=[Optional()])
    category = SelectField("Category", choices=BILL_CATEGORIES)
    name = text("Bill name", required=True, max_len=160)
    provider = text("Provider", max_len=120)
    bill_number = text("Bill number", max_len=80)
    period_label = text("Billing period (e.g. Oct 2026)", max_len=60)
    received_on = DateField("Bill received on", validators=[Optional()])
    due_date = DateField("Due date", validators=[Optional()])
    amount = money("Bill amount (₹)")
    responsible = SelectField("Who pays?", choices=RESPONSIBLE)
    owner_share = money("My share if shared (₹)", required=False)
    tenant_payment_state = SelectField("Tenant payment", choices=TENANT_PAYMENT_STATES)
    is_cancelled = BooleanField("Cancelled")
    notes = notes()

    def validate(self, extra_validators=None):
        # Done here, not as an inline validator: Optional() skips inline validators on blank input.
        ok = super().validate(extra_validators)
        if self.responsible.data == "shared":
            share = self.owner_share.data
            if share is None:
                self.owner_share.errors = list(self.owner_share.errors) + ["Enter my share for a shared bill."]
                ok = False
            elif self.amount.data is not None and share > self.amount.data:
                self.owner_share.errors = list(self.owner_share.errors) + ["My share can't be more than the bill amount."]
                ok = False
        return ok


class CommitmentForm(FlaskForm):
    kind = SelectField("Type", choices=KINDS)
    name = text("Name (e.g. Jio – Mom, LIC Jeevan Anand, Home loan)", required=True, max_len=160)
    provider = text("Provider / operator / bank", max_len=120)
    member_id = SelectField("Family member", coerce=opt_int, validators=[Optional()])
    reference = text("Number / policy no. (keep partial)", max_len=80)
    amount = money("Amount per payment (₹)")
    frequency = SelectField("Frequency", choices=FREQUENCIES)
    interval_days = IntegerField("Every N days (custom only)", validators=[Optional(), NumberRange(min=1, max=3650)])
    next_due_date = DateField("Next due date", validators=[Optional()])
    status = SelectField("Status", choices=STATUSES)
    start_date = DateField("Start date", validators=[Optional()])
    end_date = DateField("End / maturity date", validators=[Optional()])
    auto_renew = BooleanField("Auto-renews")
    total_amount = money("Loan amount / sum assured (₹)", required=False)
    total_installments = IntegerField("Total installments (EMI)", validators=[Optional(), NumberRange(min=1, max=1200)])
    installments_done = IntegerField("Installments already paid before tracking", default=0,
                                     validators=[Optional(), NumberRange(min=0, max=1200)])
    plan_type = SelectField("Mobile plan type", choices=[("", "—"), ("prepaid", "Prepaid"), ("postpaid", "Postpaid")],
                            validators=[Optional()])
    validity_days = IntegerField("Prepaid validity (days)", validators=[Optional(), NumberRange(min=1, max=3650)])
    expiry_date = DateField("Prepaid expiry date (correct by hand if needed)", validators=[Optional()])
    notes = notes()

    def validate(self, extra_validators=None):
        ok = super().validate(extra_validators)
        if "interval_days" in self and self.frequency.data == "custom" and not self.interval_days.data:
            self.interval_days.errors = list(self.interval_days.errors) + ["Enter the number of days for a custom frequency."]
            ok = False
        return ok


class IncomeForm(FlaskForm):
    received_on = DateField("Date received", validators=[InputRequired()], default=date.today)
    kind = SelectField("Type", choices=INCOME_KINDS)
    source = text("Source (e.g. employer)", max_len=120)
    amount = positive_money("Amount (₹)")
    notes = notes()


class ExpenseForm(FlaskForm):
    spent_on = DateField("Date", validators=[InputRequired()], default=date.today)
    category = SelectField("Category", choices=[(c, c) for c in EXPENSE_CATEGORIES])
    description = text("Description", max_len=200)
    amount = positive_money("Amount (₹)")
    method = method_field()
    notes = notes()


class InvestmentForm(FlaskForm):
    name = text("Name (fund / company)", required=True, max_len=160)
    kind = SelectField("Type", choices=INVESTMENT_TYPES)
    platform = text("Platform / broker", max_len=120)
    invested_amount = money("Total invested (₹)")
    current_value = money("Current value (₹)", required=False)
    value_as_of = DateField("Value as of", validators=[Optional()], default=date.today)
    is_active = BooleanField("Still held", default=True)
    notes = notes()


class MemberForm(FlaskForm):
    name = text("Name", required=True, max_len=80)
    is_active = BooleanField("Active", default=True)


class MonthForm(FlaskForm):
    class Meta:
        csrf = False
