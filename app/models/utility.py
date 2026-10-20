from app.extensions import db
from app.models.mixins import TimestampMixin

CONNECTION_KINDS = [
    ("electricity", "Electricity"),
    ("gas", "Gas"),
    ("water", "Water"),
    ("internet", "Internet"),
    ("other", "Other"),
]
CONNECTION_LABELS = dict(CONNECTION_KINDS)


class UtilityConnection(TimestampMixin, db.Model):
    """One electricity/gas/etc. connection. A property can have several."""

    __tablename__ = "utility_connection"

    id = db.Column(db.Integer, primary_key=True)
    property_id = db.Column(db.Integer, db.ForeignKey("property.id"), nullable=False, index=True)
    kind = db.Column(db.String(20), nullable=False)
    provider = db.Column(db.String(120))
    nickname = db.Column(db.String(120))
    consumer_no = db.Column(db.String(60))
    meter_no = db.Column(db.String(60))
    notes = db.Column(db.Text)
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    @property
    def kind_label(self):
        return CONNECTION_LABELS.get(self.kind, self.kind)

    @property
    def masked_consumer_no(self) -> str:
        n = self.consumer_no or ""
        return n if len(n) <= 4 else "•" * (len(n) - 4) + n[-4:]

    @property
    def display(self) -> str:
        parts = [self.kind_label, self.nickname or self.provider, self.masked_consumer_no]
        return " · ".join(p for p in parts if p)

    # defined last: the name would otherwise shadow @property above
    property = db.relationship("Property", back_populates="connections")
