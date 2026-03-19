export interface Platform {
  name: string;
  loadBalancerArn: string;
}

export interface Environment {
  id: string;
  name: string;
  super_admin_url?: string;
  aws_access_key_id?: string;
  aws_secret_access_key?: string;
  aws_profile?: string;
  aws_region: string;
  kubeContext?: string;
  database?: Record<string, any>;
  redis?: Record<string, any>;
  jumpServer?: Record<string, any>;
  tenants?: { id: number; name: string }[];
  platforms?: Platform[];
  alerts?: {
    lark_webhook_url?: string;
    acceptable_status_codes?: string;
  };
}
