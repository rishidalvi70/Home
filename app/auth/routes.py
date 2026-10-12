from urllib.parse import urljoin, urlparse

from flask import current_app, flash, redirect, render_template, request, session, url_for
from flask_login import current_user, login_required, login_user, logout_user

from app.auth import bp
from app.auth.forms import ChangePasswordForm, LoginForm
from app.extensions import db, limiter, login_manager
from app.models import OwnerAccount
from app.security import burn_hash_time, validate_new_password

GENERIC_FAILURE = "Invalid username or password."


@login_manager.user_loader
def load_user(user_id: str):
    try:
        pk, nonce = user_id.split(":")
        owner = OwnerAccount.get() if int(pk) == 1 else None
        return owner if owner and owner.session_nonce == int(nonce) else None
    except ValueError:
        return None


def _is_safe_next(target: str | None) -> bool:
    if not target:
        return False
    ref, test = urlparse(request.host_url), urlparse(urljoin(request.host_url, target))
    return test.scheme in ("http", "https") and ref.netloc == test.netloc and target.startswith("/")


@bp.route("/login", methods=["GET", "POST"])
@limiter.limit(lambda: current_app.config["LOGIN_RATE_LIMIT"], methods=["POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("main.dashboard"))
    form = LoginForm()
    if form.validate_on_submit():
        owner = OwnerAccount.get()
        if owner is None:
            burn_hash_time(form.password.data)
            flash(GENERIC_FAILURE, "danger")
        elif owner.is_locked:
            flash("Too many failed attempts. Try again later.", "danger")
        elif owner.username == form.username.data and owner.check_password(form.password.data):
            owner.register_success()
            db.session.commit()
            session.clear()  # fresh session on login (prevents fixation)
            session.permanent = True
            login_user(owner)
            nxt = request.args.get("next")
            return redirect(nxt if _is_safe_next(nxt) else url_for("main.dashboard"))
        else:
            owner.register_failure()
            db.session.commit()
            flash(GENERIC_FAILURE, "danger")
        return render_template("auth/login.html", form=form), 401
    return render_template("auth/login.html", form=form), (400 if form.errors else 200)


@bp.post("/logout")
@login_required
def logout():
    logout_user()
    session.clear()
    flash("You have been signed out.", "info")
    return redirect(url_for("auth.login"))


@bp.route("/account/password", methods=["GET", "POST"])
@login_required
def change_password():
    form = ChangePasswordForm()
    if form.validate_on_submit():
        owner = current_user._get_current_object()
        problems = []
        if not owner.check_password(form.current_password.data):
            problems.append("Current password is incorrect.")
        if form.new_password.data != form.confirm_password.data:
            problems.append("New passwords do not match.")
        problems += validate_new_password(form.new_password.data)
        if form.new_password.data == form.current_password.data:
            problems.append("New password must differ from the current one.")
        if not problems:
            owner.set_password(form.new_password.data)  # rotates session nonce
            db.session.commit()
            session.clear()
            login_user(owner)  # keep this browser signed in; all others are logged out
            session.permanent = True
            flash("Password changed. Other sessions were signed out.", "success")
            return redirect(url_for("main.dashboard"))
        for p in problems:
            flash(p, "danger")
        return render_template("auth/change_password.html", form=form), 400
    return render_template("auth/change_password.html", form=form), (400 if form.errors else 200)
