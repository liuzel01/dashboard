export interface Environment {
  id: string;
  name: string;
  aws_region: string;
  aws_access_key_id: string;
  aws_secret_access_key: string;
  kubeContext: string;
}
