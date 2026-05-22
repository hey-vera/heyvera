use ed25519_dalek::{Signer, Verifier};
use fips204::ml_dsa_65;
use fips204::traits::{SerDes, Signer as PqSigner, Verifier as PqVerifier};

use crate::hash;
use crate::suite::GENESIS_SUITE;
use crate::Error;

pub const MLDSA65_SIG_LEN: usize = ml_dsa_65::SIG_LEN;
pub const MLDSA65_PK_LEN: usize = ml_dsa_65::PK_LEN;
pub const MLDSA65_SK_LEN: usize = ml_dsa_65::SK_LEN;

pub struct CompositeKeypair {
    pub ed25519_sk: ed25519_dalek::SigningKey,
    pub ed25519_pk: ed25519_dalek::VerifyingKey,
    pub mldsa65_sk: ml_dsa_65::PrivateKey,
    pub mldsa65_pk: ml_dsa_65::PublicKey,
}

#[derive(Clone)]
pub struct CompositePublicKey {
    pub ed25519_pk: ed25519_dalek::VerifyingKey,
    pub mldsa65_pk: ml_dsa_65::PublicKey,
}

pub struct CompositeSignature {
    pub suite_id: u8,
    pub ed25519_sig: ed25519_dalek::Signature,
    pub mldsa65_sig: [u8; MLDSA65_SIG_LEN],
}

impl CompositeKeypair {
    pub fn generate() -> crate::Result<Self> {
        let ed25519_sk = ed25519_dalek::SigningKey::generate(&mut rand_core::OsRng);
        let ed25519_pk = ed25519_sk.verifying_key();

        let (mldsa65_pk, mldsa65_sk) =
            ml_dsa_65::try_keygen().map_err(|_| Error::KeygenFailed)?;

        Ok(Self {
            ed25519_sk,
            ed25519_pk,
            mldsa65_sk,
            mldsa65_pk,
        })
    }

    pub fn public_key(&self) -> CompositePublicKey {
        CompositePublicKey {
            ed25519_pk: self.ed25519_pk,
            mldsa65_pk: self.mldsa65_pk.clone(),
        }
    }

    pub fn heart_id(&self) -> [u8; 32] {
        self.public_key().heart_id()
    }

    pub fn sign(&self, message: &[u8]) -> crate::Result<CompositeSignature> {
        sign(
            &self.ed25519_sk,
            &self.mldsa65_sk,
            GENESIS_SUITE,
            message,
        )
    }
}

impl CompositePublicKey {
    pub fn heart_id(&self) -> [u8; 32] {
        let ed_bytes = self.ed25519_pk.as_bytes();
        let pq_bytes = self.mldsa65_pk.clone().into_bytes();
        hash::heart_id(ed_bytes, &pq_bytes)
    }

    pub fn verify(&self, message: &[u8], sig: &CompositeSignature) -> bool {
        verify(&self.ed25519_pk, &self.mldsa65_pk, message, sig)
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let pq_bytes = self.mldsa65_pk.clone().into_bytes();
        let mut out = Vec::with_capacity(32 + pq_bytes.len());
        out.extend_from_slice(self.ed25519_pk.as_bytes());
        out.extend_from_slice(&pq_bytes);
        out
    }
}

pub fn sign(
    sk_ed: &ed25519_dalek::SigningKey,
    sk_pq: &ml_dsa_65::PrivateKey,
    suite_id: u8,
    message: &[u8],
) -> crate::Result<CompositeSignature> {
    let ed25519_sig = sk_ed.sign(message);
    let mldsa65_sig = sk_pq
        .try_sign(message, b"")
        .map_err(|_| Error::SigningFailed)?;

    Ok(CompositeSignature {
        suite_id,
        ed25519_sig,
        mldsa65_sig,
    })
}

pub fn verify(
    pk_ed: &ed25519_dalek::VerifyingKey,
    pk_pq: &ml_dsa_65::PublicKey,
    message: &[u8],
    sig: &CompositeSignature,
) -> bool {
    if pk_ed.verify(message, &sig.ed25519_sig).is_err() {
        return false;
    }
    pk_pq.verify(message, &sig.mldsa65_sig, b"")
}

impl CompositeSignature {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(1 + 64 + MLDSA65_SIG_LEN);
        out.push(self.suite_id);
        out.extend_from_slice(&self.ed25519_sig.to_bytes());
        out.extend_from_slice(&self.mldsa65_sig);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cs1_sign_verify_roundtrip() {
        let kp = CompositeKeypair::generate().unwrap();
        let msg = b"soma protocol test message";
        let sig = kp.sign(msg).unwrap();
        assert!(kp.public_key().verify(msg, &sig));
    }

    #[test]
    fn cs2_bit_flip_ed25519() {
        let kp = CompositeKeypair::generate().unwrap();
        let msg = b"invariant CS-2 test";
        let sig = kp.sign(msg).unwrap();

        let mut bad_ed_bytes = sig.ed25519_sig.to_bytes();
        bad_ed_bytes[0] ^= 1;
        let bad_sig = CompositeSignature {
            suite_id: sig.suite_id,
            ed25519_sig: ed25519_dalek::Signature::from_bytes(&bad_ed_bytes),
            mldsa65_sig: sig.mldsa65_sig,
        };
        assert!(!kp.public_key().verify(msg, &bad_sig));
    }

    #[test]
    fn cs2_bit_flip_mldsa() {
        let kp = CompositeKeypair::generate().unwrap();
        let msg = b"invariant CS-2 test pq";
        let sig = kp.sign(msg).unwrap();

        let mut bad_pq_sig = sig.mldsa65_sig;
        bad_pq_sig[0] ^= 1;
        let bad_sig = CompositeSignature {
            suite_id: sig.suite_id,
            ed25519_sig: sig.ed25519_sig,
            mldsa65_sig: bad_pq_sig,
        };
        assert!(!kp.public_key().verify(msg, &bad_sig));
    }

    #[test]
    fn cs3_valid_ed_invalid_pq() {
        let kp = CompositeKeypair::generate().unwrap();
        let kp2 = CompositeKeypair::generate().unwrap();
        let msg = b"invariant CS-3: both independently necessary";

        let sig1 = kp.sign(msg).unwrap();
        let sig2 = kp2.sign(msg).unwrap();

        let mixed = CompositeSignature {
            suite_id: GENESIS_SUITE,
            ed25519_sig: sig1.ed25519_sig,
            mldsa65_sig: sig2.mldsa65_sig,
        };
        assert!(!kp.public_key().verify(msg, &mixed));
    }

    #[test]
    fn cs3_valid_pq_invalid_ed() {
        let kp = CompositeKeypair::generate().unwrap();
        let kp2 = CompositeKeypair::generate().unwrap();
        let msg = b"invariant CS-3: reversed";

        let sig1 = kp.sign(msg).unwrap();
        let sig2 = kp2.sign(msg).unwrap();

        let mixed = CompositeSignature {
            suite_id: GENESIS_SUITE,
            ed25519_sig: sig2.ed25519_sig,
            mldsa65_sig: sig1.mldsa65_sig,
        };
        assert!(!kp.public_key().verify(msg, &mixed));
    }

    #[test]
    fn wrong_message_fails() {
        let kp = CompositeKeypair::generate().unwrap();
        let sig = kp.sign(b"correct message").unwrap();
        assert!(!kp.public_key().verify(b"wrong message", &sig));
    }

    #[test]
    fn heart_id_deterministic() {
        let kp = CompositeKeypair::generate().unwrap();
        let id1 = kp.heart_id();
        let id2 = kp.public_key().heart_id();
        assert_eq!(id1, id2);
    }

    #[test]
    fn different_keys_different_heart_id() {
        let kp1 = CompositeKeypair::generate().unwrap();
        let kp2 = CompositeKeypair::generate().unwrap();
        assert_ne!(kp1.heart_id(), kp2.heart_id());
    }

    #[test]
    fn signature_serialization() {
        let kp = CompositeKeypair::generate().unwrap();
        let sig = kp.sign(b"serialization test").unwrap();
        let bytes = sig.to_bytes();
        assert_eq!(bytes[0], GENESIS_SUITE);
        assert_eq!(bytes.len(), 1 + 64 + MLDSA65_SIG_LEN);
    }

    #[test]
    fn export_test_vectors() {
        let kp = CompositeKeypair::generate().unwrap();
        let msg = b"soma protocol composite signature test vector";
        let sig = kp.sign(msg).unwrap();

        let pk_bytes = kp.public_key().to_bytes();
        let sig_bytes = sig.to_bytes();

        let vectors = serde_json::json!({
            "composite_signature": [{
                "description": "Valid composite signature over test message",
                "ed25519_pk_hex": hex::encode(kp.ed25519_pk.as_bytes()),
                "mldsa65_pk_hex": hex::encode(kp.mldsa65_pk.clone().into_bytes()),
                "composite_pk_hex": hex::encode(&pk_bytes),
                "heart_id_hex": hex::encode(kp.heart_id()),
                "message_hex": hex::encode(msg),
                "suite_id": GENESIS_SUITE,
                "signature_hex": hex::encode(&sig_bytes),
                "ed25519_sig_hex": hex::encode(sig.ed25519_sig.to_bytes()),
                "mldsa65_sig_hex": hex::encode(sig.mldsa65_sig),
                "valid": true,
            }],
        });
        let json = serde_json::to_string_pretty(&vectors).unwrap();
        std::fs::create_dir_all("test-vectors").ok();
        std::fs::write("test-vectors/composite.json", json).unwrap();
    }
}
