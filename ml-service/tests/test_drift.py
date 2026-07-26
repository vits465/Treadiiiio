import pytest
import numpy as np
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from models.drift import calculate_psi

def test_psi_identical_distributions():
    base = np.random.normal(0, 1, 1000)
    curr = base.copy()
    psi = calculate_psi(base, curr)
    assert psi == 0.0 or psi < 0.05

def test_psi_shifted_distribution():
    base = np.random.normal(0, 1, 1000)
    curr = np.random.normal(2, 1, 1000) # Distribution shifted by 2 stds
    psi = calculate_psi(base, curr)
    assert psi >= 0.2
