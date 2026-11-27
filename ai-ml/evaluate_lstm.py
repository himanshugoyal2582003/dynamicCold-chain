"""
Train/Validation/Test Evaluation Pipeline for SpoilageLSTM & InsuranceLSTM.
Computes MAE, RMSE, ROC-AUC, per-product metrics, and baseline comparisons
on a held-out 15% test split and saves artifacts/eval_report.json.
"""

import json
import os
import numpy as np
import torch

from train_lstm import (
    ARTIFACTS_DIR,
    SEED,
    InsuranceLSTM,
    SpoilageLSTM,
    generate_insurance_dataset,
    generate_spoilage_dataset,
    train_model,
)
from simulator import PRODUCT_PROFILES


def _mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.mean(np.abs(y_true - y_pred)))


def _rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2)))


def _roc_auc(y_binary: np.ndarray, y_score: np.ndarray) -> float:
    pos = y_score[y_binary == 1]
    neg = y_score[y_binary == 0]
    if len(pos) == 0 or len(neg) == 0:
        return 0.5
    # Exact pairwise Mann-Whitney U statistic
    wins = 0.0
    for p in pos:
        wins += float(np.sum(p > neg)) + 0.5 * float(np.sum(p == neg))
    return float(wins / (len(pos) * len(neg)))


def split_dataset(X: np.ndarray, y: np.ndarray, train_frac=0.70, val_frac=0.15):
    rng = np.random.default_rng(SEED)
    idx = rng.permutation(len(X))
    n_train = int(len(X) * train_frac)
    n_val = int(len(X) * val_frac)
    tr_idx, va_idx, te_idx = idx[:n_train], idx[n_train : n_train + n_val], idx[n_train + n_val :]
    return (X[tr_idx], y[tr_idx]), (X[va_idx], y[va_idx]), (X[te_idx], y[te_idx])


def run_evaluation(retrain_on_split: bool = True) -> dict:
    # 1. SpoilageLSTM
    X_sp, y_sp = generate_spoilage_dataset(2400)
    (X_sp_tr, y_sp_tr), (X_sp_va, y_sp_va), (X_sp_te, y_sp_te) = split_dataset(X_sp, y_sp)

    sp_model = SpoilageLSTM()
    sp_path = os.path.join(ARTIFACTS_DIR, "spoilage_lstm.pt")
    if retrain_on_split:
        train_model(sp_model, X_sp_tr, y_sp_tr, epochs=25)
        torch.save(sp_model.state_dict(), sp_path)
    elif os.path.exists(sp_path):
        sp_model.load_state_dict(torch.load(sp_path, map_location="cpu", weights_only=True))

    sp_model.eval()
    with torch.no_grad():
        sp_val_pred = sp_model(torch.from_numpy(X_sp_va)).numpy()
        sp_test_pred = sp_model(torch.from_numpy(X_sp_te)).numpy()

    baseline_risk = np.full_like(y_sp_te[:, 0], float(np.mean(y_sp_tr[:, 0])))
    sp_high_true = (y_sp_te[:, 0] >= 0.45).astype(int)

    # Per-product breakdown using normalized target_temp feature (index 1)
    per_product = {}
    for name, prof in PRODUCT_PROFILES.items():
        norm_target = (prof["target_temp"] + 30.0) / 60.0
        mask = np.abs(X_sp_te[:, -1, 1] - norm_target) < 0.015
        if np.any(mask):
            per_product[name] = {
                "samples": int(np.sum(mask)),
                "risk_mae": round(_mae(y_sp_te[mask, 0], sp_test_pred[mask, 0]), 4),
                "rsl_ratio_mae": round(_mae(y_sp_te[mask, 1], sp_test_pred[mask, 1]), 4),
            }

    # 2. InsuranceLSTM
    X_ins, y_ins = generate_insurance_dataset(2000)
    (X_ins_tr, y_ins_tr), (X_ins_va, y_ins_va), (X_ins_te, y_ins_te) = split_dataset(X_ins, y_ins)

    ins_model = InsuranceLSTM()
    ins_path = os.path.join(ARTIFACTS_DIR, "insurance_lstm.pt")
    if retrain_on_split:
        train_model(ins_model, X_ins_tr, y_ins_tr, epochs=25)
        torch.save(ins_model.state_dict(), ins_path)
    elif os.path.exists(ins_path):
        ins_model.load_state_dict(torch.load(ins_path, map_location="cpu", weights_only=True))

    ins_model.eval()
    with torch.no_grad():
        ins_val_pred = ins_model(torch.from_numpy(X_ins_va)).numpy()
        ins_test_pred = ins_model(torch.from_numpy(X_ins_te)).numpy()

    true_score = 5.0 + y_ins_te[:, 0] * 90.0
    pred_score = 5.0 + ins_test_pred[:, 0] * 90.0
    base_score = np.full_like(true_score, float(np.mean(5.0 + y_ins_tr[:, 0] * 90.0)))

    true_mult = 0.75 + y_ins_te[:, 1] * 0.75
    pred_mult = 0.75 + ins_test_pred[:, 1] * 0.75

    report = {
        "dataset_type": "synthetic_benchmark",
        "note": "Evaluated on held-out 15% synthetic sequences; real-world refrigerated cargo validation requires empirical trip logs.",
        "splits": {"train": 0.70, "validation": 0.15, "test": 0.15},
        "spoilage_lstm": {
            "val_risk_mae": round(_mae(y_sp_va[:, 0], sp_val_pred[:, 0]), 4),
            "test_risk_mae": round(_mae(y_sp_te[:, 0], sp_test_pred[:, 0]), 4),
            "test_risk_rmse": round(_rmse(y_sp_te[:, 0], sp_test_pred[:, 0]), 4),
            "test_rsl_ratio_mae": round(_mae(y_sp_te[:, 1], sp_test_pred[:, 1]), 4),
            "test_rsl_ratio_rmse": round(_rmse(y_sp_te[:, 1], sp_test_pred[:, 1]), 4),
            "test_high_risk_roc_auc": round(_roc_auc(sp_high_true, sp_test_pred[:, 0]), 4),
            "baseline_mean_risk_mae": round(_mae(y_sp_te[:, 0], baseline_risk), 4),
            "baseline_mean_risk_rmse": round(_rmse(y_sp_te[:, 0], baseline_risk), 4),
            "per_product": per_product,
        },
        "insurance_lstm": {
            "val_risk_norm_mae": round(_mae(y_ins_va[:, 0], ins_val_pred[:, 0]), 4),
            "test_risk_score_mae": round(_mae(true_score, pred_score), 2),
            "test_risk_score_rmse": round(_rmse(true_score, pred_score), 2),
            "test_multiplier_mae": round(_mae(true_mult, pred_mult), 4),
            "test_multiplier_rmse": round(_rmse(true_mult, pred_mult), 4),
            "baseline_mean_score_mae": round(_mae(true_score, base_score), 2),
            "baseline_mean_score_rmse": round(_rmse(true_score, base_score), 2),
        },
    }

    report_path = os.path.join(ARTIFACTS_DIR, "eval_report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    return report


if __name__ == "__main__":
    result = run_evaluation(retrain_on_split=True)
    print(json.dumps(result, indent=2))
